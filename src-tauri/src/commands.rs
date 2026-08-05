use std::{
    collections::BTreeMap,
    path::{Path, PathBuf},
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};

use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Manager};

use crate::storage::{self, DatabaseState};

const KEYCHAIN_FILE: &str = "keychain.enc";
const SECRET_MASK: [u8; 32] = *b"evir-temporary-keychain-mask-v1!";
static KEYCHAIN_LOCK: Mutex<()> = Mutex::new(());

#[derive(Serialize)]
pub struct FileInfo {
    name: String,
    path: String,
    is_dir: bool,
    size: u64,
    modified: Option<u64>,
}

fn app_data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let path = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    std::fs::create_dir_all(&path).map_err(|error| error.to_string())?;
    Ok(path)
}

fn with_connection<T>(
    app: &AppHandle,
    operation: impl FnOnce(&rusqlite::Connection) -> rusqlite::Result<T>,
) -> Result<T, String> {
    let state = app.state::<DatabaseState>();
    let conn = state
        .conn
        .lock()
        .map_err(|_| "database lock is poisoned".to_owned())?;
    operation(&conn).map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) fn db_init(app: AppHandle) -> Result<String, String> {
    let data_dir = app_data_dir(&app)?;
    let new_conn = storage::init_db(&data_dir).map_err(|error| error.to_string())?;
    let state = app.state::<DatabaseState>();
    let mut conn = state
        .conn
        .lock()
        .map_err(|_| "database lock is poisoned".to_owned())?;
    *conn = new_conn;
    Ok(data_dir.join("evir.db").to_string_lossy().into_owned())
}

#[tauri::command]
pub(crate) fn db_query(
    app: AppHandle,
    sql: String,
    params: Vec<Value>,
) -> Result<Vec<Value>, String> {
    with_connection(&app, |conn| storage::execute_query(conn, &sql, &params))
}

#[tauri::command]
pub(crate) fn db_update(app: AppHandle, sql: String, params: Vec<Value>) -> Result<usize, String> {
    with_connection(&app, |conn| storage::execute_update(conn, &sql, &params))
}

fn crypt(payload: &[u8], nonce: &[u8; 16]) -> Vec<u8> {
    payload
        .iter()
        .enumerate()
        .map(|(index, byte)| {
            byte ^ SECRET_MASK[index % SECRET_MASK.len()] ^ nonce[index % nonce.len()]
        })
        .collect()
}

fn hex_encode(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut output = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        output.push(HEX[(byte >> 4) as usize] as char);
        output.push(HEX[(byte & 0x0f) as usize] as char);
    }
    output
}

fn hex_decode(value: &str) -> Result<Vec<u8>, String> {
    if !value.len().is_multiple_of(2) {
        return Err("invalid encrypted keychain data".to_owned());
    }
    value
        .as_bytes()
        .chunks_exact(2)
        .map(|pair| {
            let high = (pair[0] as char)
                .to_digit(16)
                .ok_or_else(|| "invalid encrypted keychain data".to_owned())?;
            let low = (pair[1] as char)
                .to_digit(16)
                .ok_or_else(|| "invalid encrypted keychain data".to_owned())?;
            Ok(((high << 4) | low) as u8)
        })
        .collect()
}

fn load_keychain(path: &Path) -> Result<BTreeMap<String, String>, String> {
    if !path.exists() {
        return Ok(BTreeMap::new());
    }
    let encoded = std::fs::read_to_string(path).map_err(|error| error.to_string())?;
    let bytes = hex_decode(&encoded)?;
    let (nonce, ciphertext) = bytes
        .split_first_chunk::<16>()
        .ok_or_else(|| "invalid encrypted keychain data".to_owned())?;
    let plaintext = crypt(ciphertext, nonce);
    serde_json::from_slice(&plaintext).map_err(|_| "invalid encrypted keychain data".to_owned())
}

fn save_keychain(path: &Path, values: &BTreeMap<String, String>) -> Result<(), String> {
    let plaintext = serde_json::to_vec(values).map_err(|error| error.to_string())?;
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_nanos()
        .to_le_bytes();
    let mut encrypted = nonce.to_vec();
    encrypted.extend(crypt(&plaintext, &nonce));
    std::fs::write(path, hex_encode(&encrypted)).map_err(|error| error.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn keychain_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app_data_dir(app)?.join(KEYCHAIN_FILE))
}

fn validate_key(key: &str) -> Result<(), String> {
    if key.trim().is_empty() || key.len() > 256 {
        return Err("keychain key must contain 1 to 256 characters".to_owned());
    }
    Ok(())
}

// TODO: Replace this temporary encrypted file with the keyring crate for production.
#[tauri::command]
pub(crate) fn keychain_set(app: AppHandle, key: String, value: String) -> Result<(), String> {
    validate_key(&key)?;
    let _guard = KEYCHAIN_LOCK
        .lock()
        .map_err(|_| "keychain lock is poisoned".to_owned())?;
    let path = keychain_path(&app)?;
    let mut values = load_keychain(&path)?;
    values.insert(key, value);
    save_keychain(&path, &values)
}

#[tauri::command]
pub(crate) fn keychain_get(app: AppHandle, key: String) -> Result<Option<String>, String> {
    validate_key(&key)?;
    let _guard = KEYCHAIN_LOCK
        .lock()
        .map_err(|_| "keychain lock is poisoned".to_owned())?;
    Ok(load_keychain(&keychain_path(&app)?)?.get(&key).cloned())
}

#[tauri::command]
pub(crate) fn keychain_delete(app: AppHandle, key: String) -> Result<(), String> {
    validate_key(&key)?;
    let _guard = KEYCHAIN_LOCK
        .lock()
        .map_err(|_| "keychain lock is poisoned".to_owned())?;
    let path = keychain_path(&app)?;
    let mut values = load_keychain(&path)?;
    values.remove(&key);
    save_keychain(&path, &values)
}

fn path_from_input(path: String) -> Result<PathBuf, String> {
    if path.trim().is_empty() {
        return Err("path must not be empty".to_owned());
    }
    Ok(PathBuf::from(path))
}

fn file_info_from_path(path: &Path) -> Result<FileInfo, String> {
    let metadata = std::fs::metadata(path).map_err(|error| error.to_string())?;
    let modified = metadata.modified().ok().and_then(|time| {
        time.duration_since(UNIX_EPOCH)
            .ok()
            .and_then(|value| u64::try_from(value.as_millis()).ok())
    });
    Ok(FileInfo {
        name: path.file_name().map_or_else(
            || path.to_string_lossy().into_owned(),
            |name| name.to_string_lossy().into_owned(),
        ),
        path: path.to_string_lossy().into_owned(),
        is_dir: metadata.is_dir(),
        size: metadata.len(),
        modified,
    })
}

#[tauri::command]
pub(crate) fn fs_read_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(path_from_input(path)?).map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) fn fs_write_file(path: String, content: String) -> Result<(), String> {
    std::fs::write(path_from_input(path)?, content).map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) fn fs_list_dir(path: String) -> Result<Vec<FileInfo>, String> {
    let mut files = std::fs::read_dir(path_from_input(path)?)
        .map_err(|error| error.to_string())?
        .map(|entry| {
            let entry = entry.map_err(|error| error.to_string())?;
            file_info_from_path(&entry.path())
        })
        .collect::<Result<Vec<_>, String>>()?;
    files.sort_by(|left, right| left.name.cmp(&right.name));
    Ok(files)
}

#[tauri::command]
pub(crate) fn fs_file_info(path: String) -> Result<FileInfo, String> {
    file_info_from_path(&path_from_input(path)?)
}
