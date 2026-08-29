use std::time::{SystemTime, UNIX_EPOCH};

use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use serde_json::Value;

use crate::secret_vault;

fn temp_vault_path(label: &str) -> std::path::PathBuf {
    let suffix = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system time must be valid")
        .as_nanos();
    let directory = std::env::temp_dir().join(format!(
        "evir-vault-{label}-{}-{suffix}",
        std::process::id()
    ));
    std::fs::create_dir_all(&directory).expect("temporary directory must be created");
    directory.join("secret-vault.json")
}

fn cleanup(path: &std::path::Path) {
    std::fs::remove_dir_all(path.parent().expect("vault path has a parent"))
        .expect("temporary directory must be removed");
}

#[test]
fn set_get_delete_round_trip() {
    let path = temp_vault_path("roundtrip");
    secret_vault::set(&path, "provider:p1:api-key", "sk-secret-1").expect("vault set must succeed");
    assert_eq!(
        secret_vault::get(&path, "provider:p1:api-key").expect("vault get must succeed"),
        Some("sk-secret-1".to_owned())
    );
    // A second key does not disturb the first.
    secret_vault::set(&path, "provider:p2:api-key", "sk-secret-2").expect("vault set must succeed");
    assert_eq!(
        secret_vault::get(&path, "provider:p1:api-key").expect("vault get must succeed"),
        Some("sk-secret-1".to_owned())
    );
    secret_vault::delete(&path, "provider:p1:api-key").expect("vault delete must succeed");
    assert_eq!(
        secret_vault::get(&path, "provider:p1:api-key").expect("vault get must succeed"),
        None
    );
    // Deleting an absent key is idempotent.
    secret_vault::delete(&path, "provider:p1:api-key").expect("vault delete must be idempotent");
    cleanup(&path);
}

#[test]
fn file_is_encrypted_at_rest() {
    let path = temp_vault_path("encrypted");
    secret_vault::set(&path, "provider:p1:api-key", "sk-plaintext-canary-9f1e")
        .expect("vault set must succeed");
    let raw = std::fs::read_to_string(&path).expect("vault file must be readable");
    assert!(!raw.contains("sk-plaintext-canary-9f1e"));
    let document: Value = serde_json::from_str(&raw).expect("vault file must be a JSON document");
    assert_eq!(document["version"], 1);
    assert!(document["entries"]["provider:p1:api-key"]["nonce"].is_string());
    assert!(document["entries"]["provider:p1:api-key"]["ciphertext"].is_string());
    cleanup(&path);
}

#[test]
#[cfg(unix)]
fn vault_file_is_owner_only() {
    use std::os::unix::fs::PermissionsExt;
    let path = temp_vault_path("permissions");
    secret_vault::set(&path, "provider:p1:api-key", "sk-secret").expect("vault set must succeed");
    let mode = std::fs::metadata(&path)
        .expect("vault file must exist")
        .permissions()
        .mode();
    assert_eq!(mode & 0o777, 0o600, "vault must be owner-read-write only");
    cleanup(&path);
}

#[test]
fn entries_survive_a_fresh_vault_instance() {
    let path = temp_vault_path("persist");
    secret_vault::set(&path, "provider:p1:api-key", "sk-persisted")
        .expect("vault set must succeed");
    // Secrets must survive restarts and rebuilds — a new vault over the same
    // file (as the next launch would use) still reads them back.
    assert_eq!(
        secret_vault::get(&path, "provider:p1:api-key").expect("vault get must succeed"),
        Some("sk-persisted".to_owned())
    );
    cleanup(&path);
}

#[test]
fn swapped_ciphertexts_fail_to_decrypt() {
    let path = temp_vault_path("aad");
    secret_vault::set(&path, "provider:a:api-key", "sk-for-a").expect("vault set must succeed");
    secret_vault::set(&path, "provider:b:api-key", "sk-for-b").expect("vault set must succeed");

    let raw = std::fs::read_to_string(&path).expect("vault file must be readable");
    let mut document: Value =
        serde_json::from_str(&raw).expect("vault file must be a JSON document");
    let entry_a = document["entries"]["provider:a:api-key"].take();
    let entry_b = document["entries"]["provider:b:api-key"].take();
    document["entries"]["provider:a:api-key"] = entry_b;
    document["entries"]["provider:b:api-key"] = entry_a;
    std::fs::write(&path, serde_json::to_string(&document).unwrap())
        .expect("tampered vault must be written");

    assert!(
        secret_vault::get(&path, "provider:a:api-key").is_err(),
        "ciphertext moved to another key name must not decrypt"
    );
    cleanup(&path);
}

#[test]
fn os_user_change_makes_vault_unreadable() {
    let path = temp_vault_path("context");
    secret_vault::set_with_context(&path, "provider:p1:api-key", "sk-bound", "vault:alice")
        .expect("vault set must succeed");
    assert_eq!(
        secret_vault::get_with_context(&path, "provider:p1:api-key", "vault:alice")
            .expect("vault get must succeed in the same context"),
        Some("sk-bound".to_owned())
    );
    // A vault file copied to another OS user (different derivation context)
    // must not decrypt; callers surface that as "re-enter the key".
    assert!(secret_vault::get_with_context(&path, "provider:p1:api-key", "vault:bob").is_err());
    cleanup(&path);
}

#[test]
fn oversized_values_are_rejected() {
    let path = temp_vault_path("cap");
    let oversized = "x".repeat(64 * 1024 + 1);
    assert!(secret_vault::set(&path, "provider:p1:api-key", &oversized).is_err());
    assert_eq!(secret_vault::get(&path, "provider:p1:api-key"), Ok(None));
    cleanup(&path);
}

#[test]
fn invalid_nonce_length_returns_error() {
    let path = temp_vault_path("nonce-length");
    secret_vault::set(&path, "provider:p1:api-key", "sk-value").expect("vault set must succeed");
    let raw = std::fs::read_to_string(&path).expect("vault file must be readable");
    let mut document: Value =
        serde_json::from_str(&raw).expect("vault file must be a JSON document");
    // Valid base64, wrong length (11 and 13 bytes instead of 12).
    for wrong_nonce in [
        BASE64.encode([0u8; 11]),
        BASE64.encode([0u8; 13]),
        String::new(),
    ] {
        document["entries"]["provider:p1:api-key"]["nonce"] = Value::String(wrong_nonce);
        std::fs::write(&path, serde_json::to_string(&document).unwrap())
            .expect("tampered vault must be written");
        let result = secret_vault::get(&path, "provider:p1:api-key");
        assert!(
            result.is_err(),
            "wrong-length nonce must return an error, got {result:?}"
        );
    }
    cleanup(&path);
}

#[test]
fn corrupted_vault_does_not_panic() {
    let path = temp_vault_path("corrupt");
    secret_vault::set(&path, "provider:p1:api-key", "sk-value").expect("vault set must succeed");
    let raw = std::fs::read_to_string(&path).expect("vault file must be readable");

    let damaged_variants: Vec<(&str, String)> = vec![
        ("invalid base64 nonce", {
            let mut doc: Value = serde_json::from_str(&raw).unwrap();
            doc["entries"]["provider:p1:api-key"]["nonce"] =
                Value::String("!!!not-base64!!!".into());
            serde_json::to_string(&doc).unwrap()
        }),
        ("invalid base64 ciphertext", {
            let mut doc: Value = serde_json::from_str(&raw).unwrap();
            doc["entries"]["provider:p1:api-key"]["ciphertext"] =
                Value::String("%%%%not-base64%%%%".into());
            serde_json::to_string(&doc).unwrap()
        }),
        ("flipped ciphertext tag byte", {
            let mut doc: Value = serde_json::from_str(&raw).unwrap();
            let ciphertext = doc["entries"]["provider:p1:api-key"]["ciphertext"]
                .as_str()
                .unwrap()
                .to_owned();
            let mut bytes = BASE64.decode(ciphertext).unwrap();
            let last = bytes.len() - 1;
            bytes[last] ^= 0xff;
            doc["entries"]["provider:p1:api-key"]["ciphertext"] =
                Value::String(BASE64.encode(bytes));
            serde_json::to_string(&doc).unwrap()
        }),
        ("truncated ciphertext", {
            let mut doc: Value = serde_json::from_str(&raw).unwrap();
            let ciphertext = doc["entries"]["provider:p1:api-key"]["ciphertext"]
                .as_str()
                .unwrap()
                .to_owned();
            let mut bytes = BASE64.decode(ciphertext).unwrap();
            bytes.truncate(bytes.len() / 2);
            doc["entries"]["provider:p1:api-key"]["ciphertext"] =
                Value::String(BASE64.encode(bytes));
            serde_json::to_string(&doc).unwrap()
        }),
        ("corrupted json", "{ not json at all".to_owned()),
        ("empty file", String::new()),
    ];

    for (label, damaged) in damaged_variants {
        std::fs::write(&path, &damaged).expect("damaged vault must be written");
        // Every damage mode must surface as Err — a present-but-empty file
        // is treated as a truncated vault, not a fresh one — never a panic.
        let result = secret_vault::get(&path, "provider:p1:api-key");
        assert!(
            result.is_err(),
            "{label} must return an error, got {result:?}"
        );
        // set() must never panic. File-level damage (corrupt or empty JSON)
        // blocks writes with a clean error; entry-level damage leaves the
        // document valid, so writes succeed and the damaged entry simply
        // stays unreadable until its owner re-enters the key.
        let write_result = secret_vault::set(&path, "provider:new:api-key", "sk-new");
        if matches!(label, "corrupted json" | "empty file") {
            assert!(write_result.is_err(), "{label}: set must fail cleanly");
        } else {
            assert!(
                write_result.is_ok(),
                "{label}: set must succeed, got {write_result:?}"
            );
        }
    }
    cleanup(&path);
}

#[test]
fn damaged_entry_does_not_block_other_keys() {
    let path = temp_vault_path("partial");
    secret_vault::set(&path, "provider:good:api-key", "sk-good").expect("vault set must succeed");
    secret_vault::set(&path, "provider:bad:api-key", "sk-bad").expect("vault set must succeed");
    let raw = std::fs::read_to_string(&path).expect("vault file must be readable");
    let mut doc: Value = serde_json::from_str(&raw).unwrap();
    doc["entries"]["provider:bad:api-key"]["nonce"] = Value::String(BASE64.encode([0u8; 5]));
    std::fs::write(&path, serde_json::to_string(&doc).unwrap())
        .expect("tampered vault must be written");

    assert!(
        secret_vault::get(&path, "provider:bad:api-key").is_err(),
        "the damaged entry must error"
    );
    assert_eq!(
        secret_vault::get(&path, "provider:good:api-key").expect("good entry must still read"),
        Some("sk-good".to_owned()),
        "an unrelated intact entry must remain readable"
    );
    cleanup(&path);
}
