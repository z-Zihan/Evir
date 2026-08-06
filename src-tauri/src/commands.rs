
use std::{
    path::{Component, Path, PathBuf},
    process::Command as StdCommand,
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

#[derive(Serialize)]
pub struct CommandResult {
    stdout: String,
    stderr: String,
    exit_code: Option<i32>,
    success: bool,
}

#[derive(Serialize)]
pub struct GitStatusEntry {
    status: String,
    file: String,
}

#[derive(Serialize)]
pub struct GitStatusResult {
    is_repo: bool,
    entries: Vec<GitStatusEntry>,
    branch: Option<String>,
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

/// Apply a unified diff patch to a file. Supports simple search-and-replace style patches.
#[tauri::command]
pub(crate) fn fs_apply_patch(
    path: String,
    old_content: String,
    new_content: String,
) -> Result<(), String> {
    let validated = validate_path(&path)?;
    // Verify the file currently contains old_content before replacing
    let current = std::fs::read_to_string(&validated).map_err(|error| error.to_string())?;
    if !current.contains(&old_content) {
        return Err("old_content not found in file — patch cannot be applied".to_owned());
    }
    let patched = current.replacen(&old_content, &new_content, 1);
    std::fs::write(&validated, patched).map_err(|error| error.to_string())
}

/// Search for files by name pattern in a directory tree (max depth 5).
#[tauri::command]
pub(crate) fn fs_search_files(
    path: String,
    pattern: String,
) -> Result<Vec<String>, String> {
    let root = validate_path(&path)?;
    let pattern_lower = pattern.to_lowercase();
    let mut results = Vec::new();
    search_recursive(&root, &pattern_lower, &mut results, 0, 5);
    Ok(results)
}

fn search_recursive(
    dir: &Path,
    pattern: &str,
    results: &mut Vec<String>,
    depth: usize,
    max_depth: usize,
) {
    if depth > max_depth || results.len() >= 200 {
        return;
    }
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_lowercase();
            let path = entry.path();
            if name.contains(pattern) {
                results.push(path.to_string_lossy().into_owned());
                if results.len() >= 200 {
                    return;
                }
            }
            if path.is_dir() && !name.starts_with('.') && name != "node_modules" && name != "target" {
                search_recursive(&path, pattern, results, depth + 1, max_depth);
            }
        }
    }
}

/// Execute a shell command in the workspace directory.
/// Uses argument array (no shell interpolation) for safety.
#[tauri::command]
pub(crate) fn run_command(
    cwd: String,
    program: String,
    args: Vec<String>,
    timeout_ms: Option<u64>,
) -> Result<CommandResult, String> {
    let cwd = validate_path(&cwd)?;
    let mut cmd = StdCommand::new(&program);
    cmd.args(&args);
    cmd.current_dir(&cwd);
    cmd.stdout(std::process::Stdio::piped());
    cmd.stderr(std::process::Stdio::piped());

    let timeout = std::time::Duration::from_millis(timeout_ms.unwrap_or(30_000));
    let start = std::time::Instant::now();

    let mut child = cmd.spawn().map_err(|error| error.to_string())?;

    // Wait with timeout
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                let stdout = child.stdout.take();
                let stderr = child.stderr.take();
                let stdout_str = match stdout {
                    Some(mut s) => {
                        use std::io::Read;
                        let mut buf = String::new();
                        s.read_to_string(&mut buf).ok();
                        truncate_string(&buf, 50_000)
                    }
                    None => String::new(),
                };
                let stderr_str = match stderr {
                    Some(mut s) => {
                        use std::io::Read;
                        let mut buf = String::new();
                        s.read_to_string(&mut buf).ok();
                        truncate_string(&buf, 50_000)
                    }
                    None => String::new(),
                };
                return Ok(CommandResult {
                    stdout: stdout_str,
                    stderr: stderr_str,
                    exit_code: status.code(),
                    success: status.success(),
                });
            }
            Ok(None) => {
                if start.elapsed() > timeout {
                    let _ = child.kill();
                    return Ok(CommandResult {
                        stdout: String::new(),
                        stderr: format!("Command timed out after {}ms", timeout.as_millis()),
                        exit_code: None,
                        success: false,
                    });
                }
                std::thread::sleep(std::time::Duration::from_millis(50));
            }
            Err(error) => return Err(error.to_string()),
        }
    }
}

fn truncate_string(s: &str, max_len: usize) -> String {
    if s.len() <= max_len {
        s.to_string()
    } else {
        format!("{}\n... truncated ({} bytes total)", &s[..max_len], s.len())
    }
}

/// Get git status for a directory.
#[tauri::command]
pub(crate) fn git_status(path: String) -> Result<GitStatusResult, String> {
    let dir = validate_path(&path)?;
    let git_dir = dir.join(".git");
    if !git_dir.exists() {
        return Ok(GitStatusResult {
            is_repo: false,
            entries: vec![],
            branch: None,
        });
    }

    let output = StdCommand::new("git")
        .args(["status", "--porcelain=v1", "-b"])
        .current_dir(&dir)
        .output()
        .map_err(|error| error.to_string())?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut entries = Vec::new();
    let mut branch = None;

    for line in stdout.lines() {
        if line.starts_with("## ") {
            // Branch line: "## main...origin/main"
            let rest = &line[3..];
            if let Some(dotdot) = rest.find("...") {
                branch = Some(rest[..dotdot].to_string());
            } else {
                branch = Some(rest.to_string());
            }
        } else if line.len() >= 3 {
            let status = line[..2].trim().to_string();
            let file = line[3..].to_string();
            entries.push(GitStatusEntry { status, file });
        }
    }

    Ok(GitStatusResult {
        is_repo: true,
        entries,
        branch,
    })
}

/// Get git diff for a directory.
#[tauri::command]
pub(crate) fn git_diff(path: String, staged: bool) -> Result<String, String> {
    let dir = validate_path(&path)?;
    let mut cmd = StdCommand::new("git");
    cmd.args(["diff"]);
    if staged {
        cmd.arg("--staged");
    }
    cmd.current_dir(&dir);
    cmd.stdout(std::process::Stdio::piped());

    let output = cmd.output().map_err(|error| error.to_string())?;
    let diff = String::from_utf8_lossy(&output.stdout);
    Ok(truncate_string(&diff, 100_000))
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
