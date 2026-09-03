//! Shared command infrastructure: the app data dir, database connection
//! wrapper, path/entity/key/component validation, the command cancellation
//! registry, crash-safe file replacement, and small utilities used across
//! domains.
//!
//! Judgment calls (items serving more than one domain live here):
//! - `validate_path_in_workspace` is enforced by filesystem, processes, git,
//!   and snapshots alike, and `dev_server.rs` calls it too.
//! - `STRUCTURED_ENTITIES` sits next to its only runtime consumer,
//!   `validate_entity`; the entity commands live in `entities`.
//! - `is_symlink`, `replace_file_atomically`, `truncate_string`,
//!   `uuid_string`, and `system_time_now_ms` are generic file/process
//!   utilities shared by the domain modules.

use std::{
    collections::HashMap,
    path::{Component, Path, PathBuf},
    sync::{atomic::AtomicBool, Arc, Mutex, OnceLock},
    time::{SystemTime, UNIX_EPOCH},
};

use tauri::{AppHandle, Manager};

use crate::storage::DatabaseState;

// Keep in sync with EntityName in src/core/storage/storage-port.ts (the web
// adapter intentionally supports only the Dexie-backed subset).
const STRUCTURED_ENTITIES: &[&str] = &[
    "projects",
    "providers",
    "conversations",
    "messages",
    "attachments",
    "agent_runs",
    "task_briefs",
    "plans",
    "run_steps",
    "run_events",
    "agent_assignments",
    "approvals",
    "tool_executions",
    "memories",
    "skills",
    "mcp_servers",
    "artifacts",
    "backups",
    "notifications",
    "shortcuts",
    "personalization",
    "usage_records",
    "settings",
];

pub(crate) type CommandCancellationMap = HashMap<String, Arc<AtomicBool>>;

pub(crate) fn command_cancellations() -> &'static Mutex<CommandCancellationMap> {
    static CANCELLATIONS: OnceLock<Mutex<CommandCancellationMap>> = OnceLock::new();
    CANCELLATIONS.get_or_init(|| Mutex::new(HashMap::new()))
}

pub(crate) struct CommandRegistration(pub(crate) String);

impl Drop for CommandRegistration {
    fn drop(&mut self) {
        if let Ok(mut cancellations) = command_cancellations().lock() {
            cancellations.remove(&self.0);
        }
    }
}

pub(crate) fn validate_entity(entity: &str) -> Result<(), String> {
    if STRUCTURED_ENTITIES.contains(&entity) {
        Ok(())
    } else {
        Err("unsupported structured storage entity".to_owned())
    }
}

pub(crate) fn app_data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let path = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    std::fs::create_dir_all(&path).map_err(|error| error.to_string())?;
    Ok(path)
}

pub(crate) fn with_connection<T>(
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

pub(crate) fn validate_key(key: &str) -> Result<(), String> {
    if key.trim().is_empty() || key.len() > 256 {
        return Err("keychain key must contain 1 to 256 characters".to_owned());
    }
    Ok(())
}

#[cfg(not(windows))]
pub(crate) fn replace_file_atomically(source: &Path, destination: &Path) -> Result<(), String> {
    std::fs::rename(source, destination).map_err(|error| error.to_string())
}

/// Crash-safe file replacement for workspace writes: write a sibling temp
/// file, fsync, then swap it in. Unlike truncate-in-place, a crash mid-write
/// leaves the original intact, and a symlink at the destination is replaced
/// rather than followed.
pub(crate) fn write_file_atomically(target: &Path, contents: &str) -> Result<(), String> {
    let directory = target.parent().ok_or("file has no parent directory")?;
    let temp = directory.join(format!(
        ".evir-write-{}-{}.tmp",
        std::process::id(),
        uuid_string()
    ));
    if let Err(error) = std::fs::write(&temp, contents) {
        let _ = std::fs::remove_file(&temp);
        return Err(error.to_string());
    }
    let sync = std::fs::File::open(&temp).and_then(|file| file.sync_all());
    if let Err(error) = sync {
        let _ = std::fs::remove_file(&temp);
        return Err(error.to_string());
    }
    if let Err(error) = replace_file_atomically(&temp, target) {
        let _ = std::fs::remove_file(&temp);
        return Err(error);
    }
    Ok(())
}

#[cfg(windows)]
pub(crate) fn replace_file_atomically(source: &Path, destination: &Path) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{
        MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
    };

    let source: Vec<u16> = source.as_os_str().encode_wide().chain(Some(0)).collect();
    let destination: Vec<u16> = destination
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect();
    // SAFETY: Both paths are valid, null-terminated UTF-16 buffers for the duration of the call.
    let result = unsafe {
        MoveFileExW(
            source.as_ptr(),
            destination.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    };
    if result == 0 {
        Err(std::io::Error::last_os_error().to_string())
    } else {
        Ok(())
    }
}

pub(crate) fn validate_path(path: &str) -> Result<PathBuf, String> {
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
    let canonical = if suffix.as_os_str().is_empty() {
        canonical_ancestor
    } else {
        canonical_ancestor.join(suffix)
    };
    // Note: `/private/var` (where macOS `/var` canonicalizes, incl. TMPDIR
    // workspaces) is deliberately NOT blocked here — real workspaces live under
    // it; the lexical `/var` block on the TS layer carries that policy.
    let mut blocked: Vec<PathBuf> = [
        "/etc",
        "/var",
        "/usr",
        "/bin",
        "/sbin",
        "/System",
        "/private/etc",
    ]
    .iter()
    .map(PathBuf::from)
    .collect();
    // The TS-side home-prefix block never fires in the WebView (`process` is
    // undefined there, so its homeDir() falls back to "/"); this layer is the
    // only one that can actually enforce it for the Full Access profile.
    if let Some(home) = home_sensitive_root() {
        blocked.extend([
            home.join(".ssh"),
            home.join(".gnupg"),
            home.join("Library/Keychains"),
        ]);
    }
    for prefix in &blocked {
        if canonical.starts_with(prefix) {
            return Err(format!("access to {} is not allowed", prefix.display()));
        }
    }
    Ok(canonical)
}

fn home_sensitive_root() -> Option<PathBuf> {
    std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" }).map(PathBuf::from)
}

/// Identifiers that are joined into filesystem paths (snapshot run/snapshot
/// ids, worktree ids) must stay a single path component. The TS callers
/// sanitize today, but the Rust boundary has to defend for itself: these
/// values originate from model-controlled tool parameters.
pub(crate) fn validate_component_id(kind: &str, value: &str) -> Result<(), String> {
    if value.is_empty()
        || value.len() > 128
        || value == "."
        || value == ".."
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.'))
    {
        return Err(format!("invalid {kind}"));
    }
    Ok(())
}

pub(crate) fn validate_path_in_workspace(
    path: &str,
    workspace_root: &str,
) -> Result<PathBuf, String> {
    if workspace_root.is_empty() {
        return Err("no workspace is selected".to_owned());
    }
    let root = validate_path(workspace_root)?;
    let validated = validate_path(path)?;
    if !root.is_dir() {
        // Full Access passes the target path itself as its root; allow only the
        // exact file, never a directory of unrelated paths.
        if validated == root {
            return Ok(validated);
        }
        return Err("workspace root is not an accessible directory".to_owned());
    }
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
pub(crate) fn is_symlink(path: &Path) -> bool {
    std::fs::symlink_metadata(path)
        .map(|m| m.file_type().is_symlink())
        .unwrap_or(false)
}

pub(crate) fn truncate_string(s: &str, max_len: usize) -> String {
    if s.len() <= max_len {
        s.to_string()
    } else {
        // max_len is a byte budget; slicing mid-codepoint would panic on CJK output.
        let mut end = max_len;
        while end > 0 && !s.is_char_boundary(end) {
            end -= 1;
        }
        format!("{}\n... truncated ({} bytes total)", &s[..end], s.len())
    }
}

pub(crate) fn uuid_string() -> String {
    use std::time::SystemTime;
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    // Full subsec nanos: the %100000 truncation collided within ~100µs and
    // made one snapshot's metadata overwrite another's.
    format!("{}-{}", now.as_millis(), now.subsec_nanos())
}

pub(crate) fn system_time_now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .ok()
        .and_then(|v| u64::try_from(v.as_millis()).ok())
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::{
        truncate_string, validate_component_id, validate_entity, validate_path,
        validate_path_in_workspace, STRUCTURED_ENTITIES,
    };
    use crate::commands::filesystem::fs_read_file;

    #[test]
    fn structured_entity_validation_is_allowlist_only() {
        for entity in STRUCTURED_ENTITIES {
            assert!(validate_entity(entity).is_ok(), "expected {entity} to pass");
        }
        assert_eq!(
            validate_entity("app_entities; DROP TABLE app_entities"),
            Err("unsupported structured storage entity".to_owned())
        );
        assert!(validate_entity("unknown").is_err());
    }

    #[test]
    fn component_ids_reject_path_traversal() {
        for valid in ["run-123", "abc_DEF.001", "a"] {
            assert!(validate_component_id("snapshot run id", valid).is_ok());
        }
        for invalid in [
            "",
            ".",
            "..",
            "../escape",
            "run/../../etc",
            "run\\escape",
            "with space",
        ] {
            assert!(
                validate_component_id("snapshot run id", invalid).is_err(),
                "expected {invalid:?} to be rejected"
            );
        }
        let overlong = "a".repeat(129);
        assert!(validate_component_id("worktree id", &overlong).is_err());
    }

    #[test]
    fn truncate_string_stays_on_char_boundaries() {
        // CJK characters are 3 bytes each; any byte budget lands mid-codepoint.
        let cjk = "汉".repeat(40_000);
        let truncated = truncate_string(&cjk, 50_000);
        assert!(truncated.contains("... truncated ("));
        let body = truncated.split("\n... truncated").next().expect("has body");
        let prefix = &cjk[..body.len()];
        assert_eq!(body, prefix);
        assert!(body.len() <= 50_000);

        let short = "abc".to_owned();
        assert_eq!(truncate_string(&short, 50_000), short);
    }

    #[test]
    fn validate_path_blocks_sensitive_home_locations() {
        let home = std::env::var("HOME").expect("HOME should be set for tests");
        for sensitive in [
            ".ssh/id_rsa",
            ".gnupg/private.key",
            "Library/Keychains/login.keychain",
        ] {
            let blocked = format!("{home}/{sensitive}");
            assert!(
                validate_path(&blocked).is_err(),
                "expected {blocked} to be blocked"
            );
        }
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
        let inside_path = workspace.join("inside.txt");
        assert_eq!(
            validate_path_in_workspace(&inside_path.to_string_lossy(), &root)
                .expect("inside file should validate"),
            inside_path
                .canonicalize()
                .expect("inside file should canonicalize")
        );
        assert_eq!(
            fs_read_file(inside_path.to_string_lossy().into_owned(), root.to_string())
                .expect("existing file should be readable"),
            "inside"
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

    #[cfg(target_os = "macos")]
    #[test]
    fn workspace_validation_accepts_private_tmp_aliases() {
        use std::path::PathBuf;
        use std::time::{SystemTime, UNIX_EPOCH};

        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        let private_workspace = PathBuf::from(format!(
            "/private/tmp/evir-workspace-alias-{}-{suffix}",
            std::process::id()
        ));
        std::fs::create_dir_all(&private_workspace).expect("workspace should be created");
        let private_file = private_workspace.join("inside.txt");
        std::fs::write(&private_file, "inside").expect("fixture should be written");
        let tmp_workspace =
            private_workspace
                .to_string_lossy()
                .replacen("/private/tmp/", "/tmp/", 1);
        let tmp_file = private_file
            .to_string_lossy()
            .replacen("/private/tmp/", "/tmp/", 1);

        assert!(
            validate_path_in_workspace(&private_file.to_string_lossy(), &tmp_workspace).is_ok()
        );
        assert!(
            validate_path_in_workspace(&tmp_file, &private_workspace.to_string_lossy()).is_ok()
        );

        std::fs::remove_dir_all(&private_workspace).expect("fixture should be removed");
    }
}
