use std::{
    path::{Component, Path, PathBuf},
    time::UNIX_EPOCH,
};

use keyring::Entry;
use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Manager};

use crate::storage::{self, DatabaseState};

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
    validate_query_sql(&sql)?;
    with_connection(&app, |conn| storage::execute_query(conn, &sql, &params))
}

#[tauri::command]
pub(crate) fn db_update(app: AppHandle, sql: String, params: Vec<Value>) -> Result<usize, String> {
    validate_update_sql(&sql)?;
    with_connection(&app, |conn| storage::execute_update(conn, &sql, &params))
}

fn validate_key(key: &str) -> Result<(), String> {
    if key.trim().is_empty() || key.len() > 256 {
        return Err("keychain key must contain 1 to 256 characters".to_owned());
    }
    Ok(())
}

#[tauri::command]
pub(crate) fn keychain_set(key: String, value: String) -> Result<(), String> {
    validate_key(&key)?;
    let entry = Entry::new("evir", &key).map_err(|error| error.to_string())?;
    entry
        .set_password(&value)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) fn keychain_get(key: String) -> Result<Option<String>, String> {
    validate_key(&key)?;
    let entry = Entry::new("evir", &key).map_err(|error| error.to_string())?;
    match entry.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(error) => Err(error.to_string()),
    }
}

#[tauri::command]
pub(crate) fn keychain_delete(key: String) -> Result<(), String> {
    validate_key(&key)?;
    let entry = Entry::new("evir", &key).map_err(|error| error.to_string())?;
    match entry.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(error.to_string()),
    }
}

fn validate_path(path: &str) -> Result<PathBuf, String> {
    let path_buf = PathBuf::from(path);
    if !path_buf.is_absolute() {
        return Err("path must be absolute".to_owned());
    }
    if path_buf
        .components()
        .any(|component| component == Component::ParentDir)
    {
        return Err("path must not contain parent directory traversal".to_owned());
    }
    let canonical = path_buf.canonicalize().unwrap_or(path_buf);
    let blocked = [
        "/etc",
        "/var",
        "/usr",
        "/bin",
        "/sbin",
        "/System",
        "/private/etc",
    ];
    let path_str = canonical.to_string_lossy();
    for prefix in blocked {
        if path_str.starts_with(prefix) {
            return Err(format!("access to {prefix} is not allowed"));
        }
    }
    Ok(canonical)
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
    std::fs::read_to_string(validate_path(&path)?).map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) fn fs_write_file(path: String, content: String) -> Result<(), String> {
    std::fs::write(validate_path(&path)?, content).map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) fn fs_list_dir(path: String) -> Result<Vec<FileInfo>, String> {
    let mut files = std::fs::read_dir(validate_path(&path)?)
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
    file_info_from_path(&validate_path(&path)?)
}

fn validate_query_sql(sql: &str) -> Result<(), String> {
    let trimmed = sql.trim().to_uppercase();
    if !trimmed.starts_with("SELECT")
        && !trimmed.starts_with("WITH")
        && !trimmed.starts_with("PRAGMA")
    {
        return Err("only SELECT, WITH, and PRAGMA queries are allowed".to_owned());
    }
    Ok(())
}

fn validate_update_sql(sql: &str) -> Result<(), String> {
    let trimmed = sql.trim().to_uppercase();
    if !trimmed.starts_with("INSERT")
        && !trimmed.starts_with("UPDATE")
        && !trimmed.starts_with("DELETE")
    {
        return Err("only INSERT, UPDATE, and DELETE are allowed".to_owned());
    }
    let lower = sql.to_lowercase();
    for keyword in ["drop", "attach", "detach", "pragma", "vacuum", "reindex"] {
        if lower.contains(keyword) {
            return Err(format!("{keyword} is not allowed"));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{validate_query_sql, validate_update_sql};

    #[test]
    fn query_validation_allows_read_statements_only() {
        for sql in [
            "SELECT * FROM messages",
            " with recent AS (SELECT 1) SELECT * FROM recent",
            "pragma table_info(messages)",
        ] {
            assert!(
                validate_query_sql(sql).is_ok(),
                "expected query to pass: {sql}"
            );
        }
        assert_eq!(
            validate_query_sql("DELETE FROM messages"),
            Err("only SELECT, WITH, and PRAGMA queries are allowed".to_owned())
        );
    }

    #[test]
    fn update_validation_allows_dml_and_blocks_dangerous_keywords() {
        for sql in [
            "INSERT INTO settings VALUES (?1, ?2)",
            " update settings SET value = ?1",
            "DELETE FROM settings WHERE name = ?1",
        ] {
            assert!(
                validate_update_sql(sql).is_ok(),
                "expected update to pass: {sql}"
            );
        }
        assert!(validate_update_sql("DROP TABLE settings").is_err());
        assert_eq!(
            validate_update_sql("DELETE FROM settings; VACUUM"),
            Err("vacuum is not allowed".to_owned())
        );
    }

    #[cfg(unix)]
    #[test]
    fn path_validation_requires_absolute_non_traversing_unblocked_paths() {
        use super::validate_path;

        assert_eq!(
            validate_path("relative/file.txt"),
            Err("path must be absolute".to_owned())
        );
        assert_eq!(
            validate_path("/tmp/../etc/passwd"),
            Err("path must not contain parent directory traversal".to_owned())
        );
        assert!(validate_path("/etc/passwd").is_err());
        assert!(validate_path("/tmp/evir-file.txt").is_ok());
    }
}
