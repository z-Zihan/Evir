//! Local encrypted vault for provider API keys and other small secrets.
//!
//! Secrets are stored as a single AES-256-GCM encrypted file in the app data
//! directory — never in the OS keychain / credential manager: rebuilt binaries
//! are ad-hoc signed with a fresh identity each build, so keychain reads would
//! re-trigger the macOS ACL prompt on every rebuild, and a denied prompt
//! effectively lost the key. The vault survives rebuilds with no OS prompt.
//!
//! Threat model, stated honestly: the file is encrypted at rest so secrets are
//! not exposed by casually opening the file or leaking it into a backup, and
//! entries are cryptographically bound to both their key name and a
//! username-derived encryption context. It does NOT defend against a dedicated local attacker who can read
//! this open-source derivation scheme — that matches the BYOM client
//! ecosystem's posture (docs/09-storage-artifacts-and-recovery.md).

use std::{
    collections::HashMap,
    fs::{self, File},
    io::Write,
    path::{Path, PathBuf},
    sync::{Mutex, OnceLock},
};

use aes_gcm::{
    aead::{Aead, AeadCore, KeyInit, OsRng, Payload},
    Aes256Gcm, Key, Nonce,
};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use hkdf::Hkdf;
use serde::{Deserialize, Serialize};
use sha2::Sha256;

const VAULT_FILE: &str = "secret-vault.json";
const VAULT_VERSION: u8 = 1;
const VAULT_SALT: &[u8] = b"evir-secret-vault-v1-hkdf-salt";
const VAULT_PEPPER: &str = "evir-local-vault-7f3c9a51d8b24e60a1f5c2d94b8e7306";
const MAX_VALUE_LEN: usize = 64 * 1024;

#[derive(Serialize, Deserialize)]
struct VaultEntry {
    nonce: String,
    ciphertext: String,
}

#[derive(Serialize, Deserialize)]
struct VaultDocument {
    version: u8,
    entries: HashMap<String, VaultEntry>,
}

impl VaultDocument {
    fn empty() -> Self {
        Self {
            version: VAULT_VERSION,
            entries: HashMap::new(),
        }
    }
}

// The Tauri async commands run on a thread pool; read-modify-write of the
// whole file must be serialized within this process (this mutex). A second app
// instance is prevented by tauri-plugin-single-instance (see lib.rs), so the
// vault file is only ever written by one Evir process.
fn vault_lock() -> &'static Mutex<()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(()))
}

/// Username-derived encryption context: a vault file copied to another
/// account (different USER/USERNAME) cannot be decrypted (reads then surface
/// as errors, which callers treat as "re-enter the key"). This is name-based
/// separation, NOT OS-backed credential isolation.
fn vault_context() -> String {
    let user = std::env::var("USER")
        .or_else(|_| std::env::var("USERNAME"))
        .unwrap_or_else(|_| "unknown".to_owned());
    format!("{VAULT_PEPPER}:{user}")
}

fn derive_key(context: &str) -> [u8; 32] {
    let hkdf = Hkdf::<Sha256>::new(Some(VAULT_SALT), context.as_bytes());
    let mut okm = [0u8; 32];
    hkdf.expand(b"evir secret vault key", &mut okm)
        .expect("32-byte HKDF-SHA256 output is always valid");
    okm
}

pub(crate) fn vault_path(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join(VAULT_FILE)
}

fn load_document(path: &Path) -> Result<VaultDocument, String> {
    let raw = match fs::read_to_string(path) {
        Ok(raw) => raw,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(VaultDocument::empty())
        }
        Err(error) => return Err(format!("secret vault is unreadable: {error}")),
    };
    // A missing file is a fresh vault, but a PRESENT yet empty file is most
    // likely a truncated write (crash mid-save). Treating it as fresh would
    // silently report every stored key as gone; surface it as corruption so
    // the user can restore from backup instead of re-entering blindly.
    // (Whitespace-only files fall through and fail JSON parsing as corrupt.)
    if raw.is_empty() {
        return Err("secret vault file is empty (possibly truncated)".to_owned());
    }
    serde_json::from_str(&raw).map_err(|error| format!("secret vault is corrupt: {error}"))
}

#[cfg(unix)]
fn restrict_permissions(file: &File) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;
    file.set_permissions(fs::Permissions::from_mode(0o600))
        .map_err(|error| format!("secret vault permissions could not be restricted: {error}"))
}

#[cfg(not(unix))]
fn restrict_permissions(_file: &File) -> Result<(), String> {
    // Windows user-profile directories are ACL-restricted to the account by
    // default; nothing extra to do for the vault file itself.
    Ok(())
}

fn save_document(path: &Path, document: &VaultDocument) -> Result<(), String> {
    let serialized = serde_json::to_string(document)
        .map_err(|error| format!("secret vault could not be serialized: {error}"))?;
    let tmp_path = path.with_extension("json.tmp");
    let mut file =
        File::create(&tmp_path).map_err(|error| format!("secret vault write failed: {error}"))?;
    restrict_permissions(&file)?;
    file.write_all(serialized.as_bytes())
        .and_then(|_| file.sync_all())
        .map_err(|error| format!("secret vault write failed: {error}"))?;
    fs::rename(&tmp_path, path).map_err(|error| format!("secret vault write failed: {error}"))
}

// The key name is the AEAD associated data, so ciphertexts cannot be swapped
// between vault fields by someone editing the file.
fn seal(context: &str, key: &str, value: &str) -> Result<VaultEntry, String> {
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&derive_key(context)));
    let nonce = Aes256Gcm::generate_nonce(&mut OsRng);
    let ciphertext = cipher
        .encrypt(
            &nonce,
            Payload {
                msg: value.as_bytes(),
                aad: key.as_bytes(),
            },
        )
        .map_err(|_| "secret vault encryption failed".to_owned())?;
    Ok(VaultEntry {
        nonce: BASE64.encode(nonce),
        ciphertext: BASE64.encode(ciphertext),
    })
}

// AES-256-GCM standard nonce size. `Nonce::from_slice` panics on any other
// length, so a corrupted or hand-edited vault file must be rejected here —
// vault damage may never take the desktop app down.
const NONCE_SIZE: usize = 12;

fn unseal(context: &str, key: &str, entry: &VaultEntry) -> Result<String, String> {
    let nonce_bytes = BASE64
        .decode(&entry.nonce)
        .map_err(|_| "secret vault entry has an invalid nonce".to_owned())?;
    if nonce_bytes.len() != NONCE_SIZE {
        return Err("secret vault entry has an invalid nonce".to_owned());
    }
    let ciphertext = BASE64
        .decode(&entry.ciphertext)
        .map_err(|_| "secret vault entry has invalid ciphertext".to_owned())?;
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&derive_key(context)));
    let plaintext = cipher
        .decrypt(
            Nonce::from_slice(&nonce_bytes),
            Payload {
                msg: &ciphertext,
                aad: key.as_bytes(),
            },
        )
        .map_err(|_| "secret vault entry could not be decrypted".to_owned())?;
    String::from_utf8(plaintext).map_err(|_| "secret vault entry is not valid UTF-8".to_owned())
}

pub(crate) fn set(path: &Path, key: &str, value: &str) -> Result<(), String> {
    set_with_context(path, key, value, &vault_context())
}

pub(crate) fn set_with_context(
    path: &Path,
    key: &str,
    value: &str,
    context: &str,
) -> Result<(), String> {
    if value.len() > MAX_VALUE_LEN {
        return Err(format!(
            "secret vault value must contain at most {MAX_VALUE_LEN} characters"
        ));
    }
    let _guard = vault_lock()
        .lock()
        .map_err(|_| "secret vault lock is poisoned".to_owned())?;
    let mut document = load_document(path)?;
    document
        .entries
        .insert(key.to_owned(), seal(context, key, value)?);
    save_document(path, &document)
}

pub(crate) fn get(path: &Path, key: &str) -> Result<Option<String>, String> {
    get_with_context(path, key, &vault_context())
}

pub(crate) fn get_with_context(
    path: &Path,
    key: &str,
    context: &str,
) -> Result<Option<String>, String> {
    let _guard = vault_lock()
        .lock()
        .map_err(|_| "secret vault lock is poisoned".to_owned())?;
    let document = load_document(path)?;
    match document.entries.get(key) {
        Some(entry) => unseal(context, key, entry).map(Some),
        None => Ok(None),
    }
}

pub(crate) fn delete(path: &Path, key: &str) -> Result<(), String> {
    let _guard = vault_lock()
        .lock()
        .map_err(|_| "secret vault lock is poisoned".to_owned())?;
    let mut document = load_document(path)?;
    if document.entries.remove(key).is_some() {
        save_document(path, &document)?;
    }
    Ok(())
}
