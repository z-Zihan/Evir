use std::{
    path::{Component, Path, PathBuf},
    process::Command as StdCommand,
    time::{SystemTime, UNIX_EPOCH},
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
    let mut existing_ancestor = path_buf.as_path();
    while !existing_ancestor.exists() {
        existing_ancestor = existing_ancestor
            .parent()
            .ok_or_else(|| "path has no accessible ancestor".to_owned())?;
    }
    let canonical_ancestor = existing_ancestor
        .canonicalize()
        .map_err(|error| format!("path is not accessible: {error}"))?;
    let suffix = path_buf
        .strip_prefix(existing_ancestor)
        .map_err(|error| error.to_string())?;
    let canonical = canonical_ancestor.join(suffix);
    let blocked = [
        "/etc",
        "/var",
        "/usr",
        "/bin",
        "/sbin",
        "/System",
        "/private/etc",
    ];
    for prefix in blocked {
        if canonical.starts_with(prefix) {
            return Err(format!("access to {prefix} is not allowed"));
        }
    }
    Ok(canonical)
}

fn validate_path_in_workspace(path: &str, workspace_root: &str) -> Result<PathBuf, String> {
    if workspace_root.is_empty() {
        return Err("no workspace is selected".to_owned());
    }
    let root = validate_path(workspace_root)?;
    if !root.is_dir() {
        return Err("workspace root is not an accessible directory".to_owned());
    }
    let validated = validate_path(path)?;
    if validated != root && !validated.starts_with(&root) {
        return Err(format!(
            "path '{}' is outside selected workspace '{}'",
            validated.display(),
            root.display()
        ));
    }
    Ok(validated)
}

/// Check if a path is a symlink
fn is_symlink(path: &Path) -> bool {
    std::fs::symlink_metadata(path)
        .map(|m| m.file_type().is_symlink())
        .unwrap_or(false)
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
pub(crate) fn fs_read_file(path: String, workspace_root: String) -> Result<String, String> {
    std::fs::read_to_string(validate_path_in_workspace(&path, &workspace_root)?)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) fn fs_write_file(
    path: String,
    content: String,
    workspace_root: String,
) -> Result<(), String> {
    std::fs::write(validate_path_in_workspace(&path, &workspace_root)?, content)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) fn fs_list_dir(path: String, workspace_root: String) -> Result<Vec<FileInfo>, String> {
    let mut files = std::fs::read_dir(validate_path_in_workspace(&path, &workspace_root)?)
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
pub(crate) fn fs_file_info(path: String, workspace_root: String) -> Result<FileInfo, String> {
    file_info_from_path(&validate_path_in_workspace(&path, &workspace_root)?)
}

/// Apply a unified diff patch to a file. Supports simple search-and-replace style patches.
#[tauri::command]
pub(crate) fn fs_apply_patch(
    path: String,
    old_content: String,
    new_content: String,
    workspace_root: String,
) -> Result<(), String> {
    let validated = validate_path_in_workspace(&path, &workspace_root)?;
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
    workspace_root: String,
) -> Result<Vec<String>, String> {
    let root = validate_path_in_workspace(&path, &workspace_root)?;
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
            if path.is_dir()
                && !is_symlink(&path)
                && !name.starts_with('.')
                && name != "node_modules"
                && name != "target"
            {
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
    env: Option<std::collections::HashMap<String, String>>,
    workspace_root: String,
) -> Result<CommandResult, String> {
    let cwd = validate_path_in_workspace(&cwd, &workspace_root)?;
    let mut cmd = StdCommand::new(&program);
    cmd.args(&args);
    cmd.current_dir(&cwd);
    if let Some(env_vars) = env {
        cmd.envs(env_vars);
    }
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
pub(crate) fn git_status(path: String, workspace_root: String) -> Result<GitStatusResult, String> {
    let dir = validate_path_in_workspace(&path, &workspace_root)?;
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
        if let Some(rest) = line.strip_prefix("## ") {
            // Branch line: "## main...origin/main"
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
pub(crate) fn git_diff(
    path: String,
    staged: bool,
    workspace_root: String,
) -> Result<String, String> {
    let dir = validate_path_in_workspace(&path, &workspace_root)?;
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

#[derive(Serialize)]
pub struct FileStat {
    name: String,
    path: String,
    is_dir: bool,
    is_file: bool,
    is_symlink: bool,
    size: u64,
    modified: Option<u64>,
    exists: bool,
}

/// Create a directory (and parents) if it doesn't exist.
#[tauri::command]
pub(crate) fn fs_create_directory(path: String, workspace_root: String) -> Result<(), String> {
    let validated = validate_path_in_workspace(&path, &workspace_root)?;
    std::fs::create_dir_all(&validated).map_err(|error| error.to_string())
}

/// Get detailed file metadata.
#[tauri::command]
pub(crate) fn fs_file_stat(path: String, workspace_root: String) -> Result<FileStat, String> {
    let validated = validate_path_in_workspace(&path, &workspace_root)?;
    let metadata = match std::fs::metadata(&validated) {
        Ok(m) => m,
        Err(_) => {
            return Ok(FileStat {
                name: validated
                    .file_name()
                    .map(|n| n.to_string_lossy().into_owned())
                    .unwrap_or_default(),
                path: validated.to_string_lossy().into_owned(),
                is_dir: false,
                is_file: false,
                is_symlink: false,
                size: 0,
                modified: None,
                exists: false,
            });
        }
    };
    let modified = metadata.modified().ok().and_then(|time| {
        time.duration_since(UNIX_EPOCH)
            .ok()
            .and_then(|v| u64::try_from(v.as_millis()).ok())
    });
    let is_symlink = is_symlink(&validated);
    Ok(FileStat {
        name: validated
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default(),
        path: validated.to_string_lossy().into_owned(),
        is_dir: metadata.is_dir(),
        is_file: metadata.is_file(),
        is_symlink,
        size: metadata.len(),
        modified,
        exists: true,
    })
}

#[derive(Serialize)]
pub struct SnapshotResult {
    snapshot_id: String,
    file_path: String,
    existed: bool,
    original_hash: Option<String>,
}

/// Create a snapshot of a file before modification.
/// Saves the original content to app data dir for later restoration.
#[tauri::command]
pub(crate) fn fs_create_snapshot(
    app: AppHandle,
    file_path: String,
    run_id: String,
    workspace_root: String,
) -> Result<SnapshotResult, String> {
    let validated = validate_path_in_workspace(&file_path, &workspace_root)?;
    let data_dir = app_data_dir(&app)?;
    let snapshot_dir = data_dir.join("snapshots").join(&run_id);
    std::fs::create_dir_all(&snapshot_dir).map_err(|e| e.to_string())?;

    let file_name = validated
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or("file".to_owned());
    let snapshot_path = snapshot_dir.join(format!("{}_{}", uuid_string(), file_name));

    let exists = validated.exists();
    let original_hash = if exists {
        let content = std::fs::read(&validated).map_err(|e| e.to_string())?;
        let hash = simple_hash(&content);
        std::fs::write(&snapshot_path, &content).map_err(|e| e.to_string())?;
        Some(hash)
    } else {
        None
    };

    let snapshot_id = uuid_string();
    // Record metadata
    let meta = serde_json::json!({
        "snapshot_id": &snapshot_id,
        "file_path": validated.to_string_lossy(),
        "snapshot_path": snapshot_path.to_string_lossy(),
        "existed": exists,
        "original_hash": &original_hash,
        "run_id": &run_id,
        "created_at": system_time_now_ms(),
    });
    let meta_path = snapshot_dir.join(format!("{snapshot_id}.json"));
    std::fs::write(&meta_path, meta.to_string()).map_err(|e| e.to_string())?;

    Ok(SnapshotResult {
        snapshot_id,
        file_path: validated.to_string_lossy().into_owned(),
        existed: exists,
        original_hash,
    })
}

/// Restore a file from a snapshot.
#[tauri::command]
pub(crate) fn fs_restore_snapshot(
    app: AppHandle,
    snapshot_id: String,
    run_id: String,
    file_path: String,
    workspace_root: String,
) -> Result<bool, String> {
    let data_dir = app_data_dir(&app)?;
    let snapshot_dir = data_dir.join("snapshots").join(&run_id);
    let meta_path = snapshot_dir.join(format!("{snapshot_id}.json"));
    let meta_str =
        std::fs::read_to_string(&meta_path).map_err(|e| format!("snapshot not found: {e}"))?;
    let meta: serde_json::Value = serde_json::from_str(&meta_str).map_err(|e| e.to_string())?;
    let snapshot_path = meta["snapshot_path"]
        .as_str()
        .ok_or("invalid snapshot metadata")?;
    let existed = meta["existed"].as_bool().unwrap_or(false);
    let original_hash = meta["original_hash"].as_str();

    let target = validate_path_in_workspace(&file_path, &workspace_root)?;

    // Check if the file has been modified since snapshot
    if let (true, Some(original_hash)) = (target.exists(), original_hash) {
        let current = std::fs::read(&target).map_err(|e| e.to_string())?;
        let current_hash = simple_hash(&current);
        if current_hash != original_hash {
            // Check if current content matches what we'd restore (already restored)
            let snapshot_content = std::fs::read(snapshot_path).map_err(|e| e.to_string())?;
            if current == snapshot_content {
                return Ok(true); // Already restored
            }
            return Err(
                "file has been modified since snapshot — cannot safely auto-restore".to_owned(),
            );
        }
    }

    if existed {
        std::fs::copy(snapshot_path, &target).map_err(|e| e.to_string())?;
    } else {
        // File didn't exist before — delete it
        if target.exists() {
            std::fs::remove_file(&target).map_err(|e| e.to_string())?;
        }
    }
    Ok(true)
}

fn uuid_string() -> String {
    use std::time::SystemTime;
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    format!("{}-{}", now.as_millis(), now.subsec_nanos() % 100000)
}

fn simple_hash(data: &[u8]) -> String {
    // Simple FNV-1a hash for content verification
    let mut hash: u64 = 0xcbf29ce484222325;
    for &byte in data {
        hash ^= byte as u64;
        hash = hash.wrapping_mul(0x100000001b3);
    }
    format!("{:016x}", hash)
}

fn system_time_now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .ok()
        .and_then(|v| u64::try_from(v.as_millis()).ok())
        .unwrap_or(0)
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
    use super::{validate_path_in_workspace, validate_query_sql, validate_update_sql};

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

    #[cfg(unix)]
    #[test]
    fn workspace_validation_blocks_outside_prefixes_and_symlink_escapes() {
        use std::os::unix::fs::symlink;
        use std::time::{SystemTime, UNIX_EPOCH};

        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        let base = std::env::temp_dir().join(format!(
            "evir-workspace-boundary-{}-{suffix}",
            std::process::id()
        ));
        let workspace = base.join("project");
        let sibling = base.join("project-copy");
        std::fs::create_dir_all(&workspace).expect("workspace should be created");
        std::fs::create_dir_all(&sibling).expect("sibling should be created");
        std::fs::write(workspace.join("inside.txt"), "inside")
            .expect("inside fixture should be written");
        std::fs::write(sibling.join("outside.txt"), "outside")
            .expect("outside fixture should be written");
        symlink(&sibling, workspace.join("escape")).expect("symlink fixture should be created");

        let root = workspace.to_string_lossy();
        assert!(
            validate_path_in_workspace(&workspace.join("inside.txt").to_string_lossy(), &root)
                .is_ok()
        );
        assert!(
            validate_path_in_workspace(&sibling.join("outside.txt").to_string_lossy(), &root)
                .is_err()
        );
        assert!(validate_path_in_workspace(
            &workspace.join("escape/outside.txt").to_string_lossy(),
            &root
        )
        .is_err());
        assert!(validate_path_in_workspace(
            &workspace.join("escape/new.txt").to_string_lossy(),
            &root
        )
        .is_err());

        std::fs::remove_dir_all(&base).expect("fixture should be removed");
    }
}
