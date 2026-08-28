use std::{
    collections::HashMap,
    fs::OpenOptions,
    io::Write,
    path::{Component, Path, PathBuf},
    process::{Child, Command as StdCommand},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex, OnceLock,
    },
    time::{SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Manager};

use crate::{
    secret_vault,
    storage::{self, DatabaseState},
};

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

type CommandCancellationMap = HashMap<String, Arc<AtomicBool>>;

fn command_cancellations() -> &'static Mutex<CommandCancellationMap> {
    static CANCELLATIONS: OnceLock<Mutex<CommandCancellationMap>> = OnceLock::new();
    CANCELLATIONS.get_or_init(|| Mutex::new(HashMap::new()))
}

struct CommandRegistration(String);

impl Drop for CommandRegistration {
    fn drop(&mut self) {
        if let Ok(mut cancellations) = command_cancellations().lock() {
            cancellations.remove(&self.0);
        }
    }
}

fn validate_entity(entity: &str) -> Result<(), String> {
    if STRUCTURED_ENTITIES.contains(&entity) {
        Ok(())
    } else {
        Err("unsupported structured storage entity".to_owned())
    }
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub(crate) enum EntityMutation {
    Write {
        entity: String,
        id: String,
        data: Value,
    },
    Delete {
        entity: String,
        id: String,
    },
    Clear {
        entity: String,
    },
}

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

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SharedProviderProfile {
    id: String,
    name: String,
    protocol_id: String,
    base_url: String,
    model_id: String,
    tool_calling: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    max_context_tokens: Option<u64>,
    enabled: bool,
    is_default: bool,
    created_at: u64,
    updated_at: u64,
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct SharedProviderDocument {
    version: u8,
    providers: Vec<SharedProviderProfile>,
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

#[tauri::command(async)]
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

#[tauri::command(async)]
pub(crate) fn db_query(
    app: AppHandle,
    sql: String,
    params: Vec<Value>,
) -> Result<Vec<Value>, String> {
    validate_query_sql(&sql)?;
    with_connection(&app, |conn| storage::execute_query(conn, &sql, &params))
}

#[tauri::command(async)]
pub(crate) fn db_update(app: AppHandle, sql: String, params: Vec<Value>) -> Result<usize, String> {
    validate_update_sql(&sql)?;
    with_connection(&app, |conn| storage::execute_update(conn, &sql, &params))
}

#[tauri::command(async)]
pub(crate) fn entity_get(
    app: AppHandle,
    entity: String,
    id: String,
) -> Result<Option<Value>, String> {
    validate_entity(&entity)?;
    with_connection(&app, |conn| {
        let mut statement =
            conn.prepare("SELECT data FROM app_entities WHERE entity = ?1 AND id = ?2")?;
        let mut rows = statement.query(rusqlite::params![entity, id])?;
        let Some(row) = rows.next()? else {
            return Ok(None);
        };
        let data: String = row.get(0)?;
        serde_json::from_str(&data).map(Some).map_err(|error| {
            rusqlite::Error::FromSqlConversionFailure(
                0,
                rusqlite::types::Type::Text,
                Box::new(error),
            )
        })
    })
}

#[tauri::command(async)]
pub(crate) fn entity_list(app: AppHandle, entity: String) -> Result<Vec<Value>, String> {
    validate_entity(&entity)?;
    with_connection(&app, |conn| {
        let mut statement = conn.prepare(
            "SELECT data FROM app_entities WHERE entity = ?1 ORDER BY updated_at DESC, id ASC",
        )?;
        let rows = statement.query_map(rusqlite::params![entity], |row| {
            let data: String = row.get(0)?;
            serde_json::from_str(&data).map_err(|error| {
                rusqlite::Error::FromSqlConversionFailure(
                    0,
                    rusqlite::types::Type::Text,
                    Box::new(error),
                )
            })
        })?;
        rows.collect()
    })
}

#[tauri::command(async)]
pub(crate) fn entity_put(
    app: AppHandle,
    entity: String,
    id: String,
    data: Value,
) -> Result<(), String> {
    validate_entity(&entity)?;
    let encoded = serde_json::to_string(&data).map_err(|error| error.to_string())?;
    with_connection(&app, |conn| {
        conn.execute(
            "INSERT INTO app_entities(entity, id, data, updated_at) VALUES (?1, ?2, ?3, ?4) \
             ON CONFLICT(entity, id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at",
            rusqlite::params![entity, id, encoded, system_time_now_ms()],
        )?;
        Ok(())
    })
}

#[tauri::command(async)]
pub(crate) fn entity_put_many(
    app: AppHandle,
    entity: String,
    records: Vec<Value>,
) -> Result<(), String> {
    validate_entity(&entity)?;
    with_connection(&app, |conn| {
        let transaction = conn.unchecked_transaction()?;
        for record in records {
            let id = record
                .get(if entity == "settings" { "name" } else { "id" })
                .and_then(Value::as_str)
                .ok_or_else(|| rusqlite::Error::InvalidParameterName("record id".to_owned()))?;
            let encoded = serde_json::to_string(&record)
                .map_err(|error| rusqlite::Error::ToSqlConversionFailure(Box::new(error)))?;
            transaction.execute(
                "INSERT INTO app_entities(entity, id, data, updated_at) VALUES (?1, ?2, ?3, ?4) \
                 ON CONFLICT(entity, id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at",
                rusqlite::params![entity, id, encoded, system_time_now_ms()],
            )?;
        }
        transaction.commit()
    })
}

#[tauri::command(async)]
pub(crate) fn entity_delete(app: AppHandle, entity: String, id: String) -> Result<(), String> {
    validate_entity(&entity)?;
    with_connection(&app, |conn| {
        conn.execute(
            "DELETE FROM app_entities WHERE entity = ?1 AND id = ?2",
            rusqlite::params![entity, id],
        )?;
        Ok(())
    })
}

#[tauri::command(async)]
pub(crate) fn entity_delete_many(
    app: AppHandle,
    entity: String,
    ids: Vec<String>,
) -> Result<(), String> {
    validate_entity(&entity)?;
    with_connection(&app, |conn| {
        let transaction = conn.unchecked_transaction()?;
        for id in ids {
            transaction.execute(
                "DELETE FROM app_entities WHERE entity = ?1 AND id = ?2",
                rusqlite::params![entity, id],
            )?;
        }
        transaction.commit()
    })
}

#[tauri::command(async)]
pub(crate) fn entity_clear(app: AppHandle, entity: String) -> Result<(), String> {
    validate_entity(&entity)?;
    with_connection(&app, |conn| {
        conn.execute(
            "DELETE FROM app_entities WHERE entity = ?1",
            rusqlite::params![entity],
        )?;
        Ok(())
    })
}

#[tauri::command(async)]
pub(crate) fn entity_apply(app: AppHandle, mutations: Vec<EntityMutation>) -> Result<(), String> {
    for mutation in &mutations {
        let entity = match mutation {
            EntityMutation::Write { entity, .. }
            | EntityMutation::Delete { entity, .. }
            | EntityMutation::Clear { entity } => entity,
        };
        validate_entity(entity)?;
    }
    with_connection(&app, |conn| {
        let transaction = conn.unchecked_transaction()?;
        for mutation in mutations {
            match mutation {
                EntityMutation::Write { entity, id, data } => {
                    let encoded = serde_json::to_string(&data).map_err(|error| {
                        rusqlite::Error::ToSqlConversionFailure(Box::new(error))
                    })?;
                    transaction.execute(
                        "INSERT INTO app_entities(entity, id, data, updated_at) VALUES (?1, ?2, ?3, ?4) \
                         ON CONFLICT(entity, id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at",
                        rusqlite::params![entity, id, encoded, system_time_now_ms()],
                    )?;
                }
                EntityMutation::Delete { entity, id } => {
                    transaction.execute(
                        "DELETE FROM app_entities WHERE entity = ?1 AND id = ?2",
                        rusqlite::params![entity, id],
                    )?;
                }
                EntityMutation::Clear { entity } => {
                    transaction.execute(
                        "DELETE FROM app_entities WHERE entity = ?1",
                        rusqlite::params![entity],
                    )?;
                }
            }
        }
        transaction.commit()
    })
}

fn validate_key(key: &str) -> Result<(), String> {
    if key.trim().is_empty() || key.len() > 256 {
        return Err("keychain key must contain 1 to 256 characters".to_owned());
    }
    Ok(())
}

/// Backed by the local encrypted vault (`secret_vault.rs`), never the OS
/// keychain: ad-hoc-signed rebuilds kept re-triggering the macOS keychain ACL
/// prompt, which could silently lose the key. The command names stay stable
/// for the TS storage bridge.
#[tauri::command(async)]
pub(crate) fn keychain_set(app: AppHandle, key: String, value: String) -> Result<(), String> {
    validate_key(&key)?;
    let path = secret_vault::vault_path(&app_data_dir(&app)?);
    secret_vault::set(&path, &key, &value)
}

#[tauri::command(async)]
pub(crate) fn keychain_get(app: AppHandle, key: String) -> Result<Option<String>, String> {
    validate_key(&key)?;
    let path = secret_vault::vault_path(&app_data_dir(&app)?);
    secret_vault::get(&path, &key)
}

#[tauri::command(async)]
pub(crate) fn keychain_delete(app: AppHandle, key: String) -> Result<(), String> {
    validate_key(&key)?;
    let path = secret_vault::vault_path(&app_data_dir(&app)?);
    secret_vault::delete(&path, &key)
}

fn shared_provider_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .config_dir()
        .map_err(|error| error.to_string())?
        .join("evir")
        .join("providers.json"))
}

#[cfg(not(windows))]
fn replace_file_atomically(source: &Path, destination: &Path) -> Result<(), String> {
    std::fs::rename(source, destination).map_err(|error| error.to_string())
}

/// Crash-safe file replacement for workspace writes: write a sibling temp
/// file, fsync, then swap it in. Unlike truncate-in-place, a crash mid-write
/// leaves the original intact, and a symlink at the destination is replaced
/// rather than followed.
fn write_file_atomically(target: &Path, contents: &str) -> Result<(), String> {
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
fn replace_file_atomically(source: &Path, destination: &Path) -> Result<(), String> {
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

fn validate_shared_provider(profile: &SharedProviderProfile) -> Result<(), String> {
    const PROTOCOLS: &[&str] = &[
        "openai-chat-completions",
        "openai-compatible-chat",
        "openai-responses",
        "anthropic-messages",
        "gemini-generate-content",
        "ollama-native",
    ];
    if profile.id.trim().is_empty() || profile.id.len() > 200 {
        return Err("provider id must contain 1 to 200 characters".to_owned());
    }
    if profile.name.trim().is_empty() || profile.name.len() > 100 {
        return Err("provider name must contain 1 to 100 characters".to_owned());
    }
    if !PROTOCOLS.contains(&profile.protocol_id.as_str()) {
        return Err("unsupported provider protocol".to_owned());
    }
    if !(profile.base_url.starts_with("http://") || profile.base_url.starts_with("https://")) {
        return Err("provider base URL must use http or https".to_owned());
    }
    if profile.model_id.trim().is_empty() || profile.model_id.len() > 200 {
        return Err("model id must contain 1 to 200 characters".to_owned());
    }
    Ok(())
}

fn merge_shared_provider_profiles(
    current: Vec<SharedProviderProfile>,
    incoming: Vec<SharedProviderProfile>,
    deleted_ids: Vec<String>,
) -> Result<Vec<SharedProviderProfile>, String> {
    let deleted: std::collections::HashSet<_> = deleted_ids.into_iter().collect();
    let mut merged: HashMap<String, SharedProviderProfile> = current
        .into_iter()
        .filter(|profile| !deleted.contains(&profile.id))
        .map(|profile| (profile.id.clone(), profile))
        .collect();
    for profile in incoming {
        if deleted.contains(&profile.id) {
            continue;
        }
        let replace = merged
            .get(&profile.id)
            .is_none_or(|current| profile.updated_at >= current.updated_at);
        if replace {
            merged.insert(profile.id.clone(), profile);
        }
    }
    if merged.len() > 100 {
        return Err("at most 100 shared Providers are allowed".to_owned());
    }
    let selected_default = merged
        .values()
        .filter(|profile| profile.enabled && profile.is_default)
        .max_by_key(|profile| profile.updated_at)
        .map(|profile| profile.id.clone());
    let mut merged: Vec<_> = merged
        .into_values()
        .map(|mut profile| {
            profile.is_default = selected_default.as_deref() == Some(profile.id.as_str());
            profile
        })
        .collect();
    merged.sort_by(|left, right| {
        right
            .updated_at
            .cmp(&left.updated_at)
            .then_with(|| left.id.cmp(&right.id))
    });
    Ok(merged)
}

#[tauri::command(async)]
pub(crate) fn shared_provider_profiles_read(
    app: AppHandle,
) -> Result<Vec<SharedProviderProfile>, String> {
    let path = shared_provider_path(&app)?;
    let raw = match std::fs::read_to_string(path) {
        Ok(raw) => raw,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => return Err(error.to_string()),
    };
    let document: SharedProviderDocument = serde_json::from_str(&raw)
        .map_err(|error| format!("invalid shared Provider file: {error}"))?;
    if document.version != 1 || document.providers.len() > 100 {
        return Err("unsupported shared Provider document".to_owned());
    }
    for profile in &document.providers {
        validate_shared_provider(profile)?;
    }
    Ok(document.providers)
}

#[tauri::command(async)]
pub(crate) fn shared_provider_profiles_write(
    app: AppHandle,
    profiles: Vec<SharedProviderProfile>,
    deleted_ids: Vec<String>,
) -> Result<(), String> {
    if profiles.len() > 100 {
        return Err("at most 100 shared Providers are allowed".to_owned());
    }
    if deleted_ids.len() > 100 {
        return Err("at most 100 shared Provider deletions are allowed".to_owned());
    }
    for profile in &profiles {
        validate_shared_provider(profile)?;
    }
    let path = shared_provider_path(&app)?;
    let parent = path
        .parent()
        .ok_or_else(|| "shared Provider path has no parent".to_owned())?;
    std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    let temporary = parent.join(format!("providers.json.{}.tmp", std::process::id()));
    let current = match std::fs::read_to_string(&path) {
        Ok(raw) => {
            let document: SharedProviderDocument = serde_json::from_str(&raw)
                .map_err(|error| format!("invalid shared Provider file: {error}"))?;
            if document.version != 1 {
                return Err("unsupported shared Provider document".to_owned());
            }
            if document.providers.len() > 100 {
                return Err("unsupported shared Provider document".to_owned());
            }
            for profile in &document.providers {
                validate_shared_provider(profile)?;
            }
            document.providers
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Vec::new(),
        Err(error) => return Err(error.to_string()),
    };
    let merged = merge_shared_provider_profiles(current, profiles, deleted_ids)?;
    let encoded = serde_json::to_vec_pretty(&SharedProviderDocument {
        version: 1,
        providers: merged,
    })
    .map_err(|error| error.to_string())?;
    let mut options = OpenOptions::new();
    options.create(true).truncate(true).write(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options
        .open(&temporary)
        .map_err(|error| error.to_string())?;
    file.write_all(&encoded)
        .map_err(|error| error.to_string())?;
    file.write_all(b"\n").map_err(|error| error.to_string())?;
    file.sync_all().map_err(|error| error.to_string())?;
    replace_file_atomically(&temporary, &path)?;
    Ok(())
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
fn validate_component_id(kind: &str, value: &str) -> Result<(), String> {
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

fn validate_path_in_workspace(path: &str, workspace_root: &str) -> Result<PathBuf, String> {
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

#[tauri::command(async)]
pub(crate) fn fs_read_file(path: String, workspace_root: String) -> Result<String, String> {
    use std::io::Read as _;
    // 1 MiB cap: the tool layer truncates to 100k chars anyway, and an
    // unbounded read lets a huge file OOM the webview bridge.
    const MAX_READ_BYTES: u64 = 1 << 20;
    let mut file = std::fs::File::open(validate_path_in_workspace(&path, &workspace_root)?)
        .map_err(|error| error.to_string())?;
    let mut bytes = Vec::with_capacity(8192);
    let _ = (&mut file).take(MAX_READ_BYTES).read_to_end(&mut bytes);
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

#[tauri::command(async)]
pub(crate) fn fs_write_file(
    path: String,
    content: String,
    workspace_root: String,
) -> Result<(), String> {
    let target = validate_path_in_workspace(&path, &workspace_root)?;
    write_file_atomically(&target, &content)
}

#[tauri::command(async)]
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

#[tauri::command(async)]
pub(crate) fn fs_file_info(path: String, workspace_root: String) -> Result<FileInfo, String> {
    file_info_from_path(&validate_path_in_workspace(&path, &workspace_root)?)
}

/// Resolve the canonical real path of a folder chosen by the user (project
/// binding and duplicate detection). No workspace containment: the input is
/// expected to come from the native folder picker.
#[tauri::command(async)]
pub(crate) fn fs_real_path(path: String) -> Result<String, String> {
    let validated = validate_path(&path)?;
    std::fs::canonicalize(&validated)
        .map(|canonical| canonical.to_string_lossy().into_owned())
        .map_err(|error| error.to_string())
}

/// Apply a unified diff patch to a file. Supports simple search-and-replace style patches.
#[tauri::command(async)]
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
    write_file_atomically(&validated, &patched)
}

/// Search for files by name pattern in a directory tree (max depth 5).
#[tauri::command(async)]
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
#[tauri::command(async)]
pub(crate) async fn run_command(
    command_id: String,
    cwd: String,
    program: String,
    args: Vec<String>,
    timeout_ms: Option<u64>,
    env: Option<std::collections::HashMap<String, String>>,
    workspace_root: String,
) -> Result<CommandResult, String> {
    // Sync commands run on the app main thread; this one polls for the whole
    // command lifetime, so it must stay off the main thread or the UI (and
    // cancel_command itself, which also arrives via IPC) freezes.
    tauri::async_runtime::spawn_blocking(move || {
        run_command_blocking(
            command_id,
            cwd,
            program,
            args,
            timeout_ms,
            env,
            workspace_root,
        )
    })
    .await
    .map_err(|error| error.to_string())?
}

fn run_command_blocking(
    command_id: String,
    cwd: String,
    program: String,
    args: Vec<String>,
    timeout_ms: Option<u64>,
    env: Option<std::collections::HashMap<String, String>>,
    workspace_root: String,
) -> Result<CommandResult, String> {
    const MAX_COMMAND_TIMEOUT_MS: u64 = 600_000;
    let cwd = validate_path_in_workspace(&cwd, &workspace_root)?;
    let cancellation = Arc::new(AtomicBool::new(false));
    command_cancellations()
        .lock()
        .map_err(|_| "command cancellation registry is poisoned".to_owned())?
        .insert(command_id.clone(), Arc::clone(&cancellation));
    let _registration = CommandRegistration(command_id);

    let mut cmd = StdCommand::new(&program);
    cmd.args(&args);
    cmd.current_dir(&cwd);
    if let Some(env_vars) = env {
        cmd.envs(env_vars);
    }
    cmd.stdin(std::process::Stdio::null());
    cmd.stdout(std::process::Stdio::piped());
    cmd.stderr(std::process::Stdio::piped());
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        cmd.process_group(0);
    }

    let timeout =
        std::time::Duration::from_millis(timeout_ms.unwrap_or(30_000).min(MAX_COMMAND_TIMEOUT_MS));
    let start = std::time::Instant::now();

    let mut child = cmd.spawn().map_err(|error| error.to_string())?;
    let stdout_reader = child.stdout.take().map(read_pipe);
    let stderr_reader = child.stderr.take().map(read_pipe);

    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                let stdout_str = join_pipe(stdout_reader);
                let stderr_str = join_pipe(stderr_reader);
                return Ok(CommandResult {
                    stdout: stdout_str,
                    stderr: stderr_str,
                    exit_code: status.code(),
                    success: status.success(),
                });
            }
            Ok(None) => {
                if cancellation.load(Ordering::SeqCst) {
                    kill_process_tree(&mut child);
                    let _ = child.wait();
                    return Ok(CommandResult {
                        stdout: join_pipe(stdout_reader),
                        stderr: "Command cancelled by user".to_owned(),
                        exit_code: None,
                        success: false,
                    });
                }
                if start.elapsed() > timeout {
                    kill_process_tree(&mut child);
                    let _ = child.wait();
                    return Ok(CommandResult {
                        stdout: join_pipe(stdout_reader),
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

#[tauri::command(async)]
pub(crate) fn cancel_command(command_id: String) -> Result<bool, String> {
    let cancellations = command_cancellations()
        .lock()
        .map_err(|_| "command cancellation registry is poisoned".to_owned())?;
    let Some(cancellation) = cancellations.get(&command_id) else {
        return Ok(false);
    };
    cancellation.store(true, Ordering::SeqCst);
    Ok(true)
}

fn read_pipe<R>(mut pipe: R) -> std::thread::JoinHandle<String>
where
    R: std::io::Read + Send + 'static,
{
    // Cap retained output so `cat huge-file` cannot OOM the app, but keep
    // draining the pipe. Closing it at the cap can send the child SIGPIPE and
    // turn an otherwise successful command into a false failure.
    const MAX_PIPE_BYTES: usize = 200_000;
    std::thread::spawn(move || {
        let mut bytes = Vec::with_capacity(8192);
        let mut chunk = [0u8; 8192];
        loop {
            match pipe.read(&mut chunk) {
                Ok(0) => break,
                Ok(read) => {
                    let remaining = MAX_PIPE_BYTES.saturating_sub(bytes.len());
                    bytes.extend_from_slice(&chunk[..read.min(remaining)]);
                }
                Err(error) if error.kind() == std::io::ErrorKind::Interrupted => continue,
                Err(_) => break,
            }
        }
        truncate_string(&String::from_utf8_lossy(&bytes), 50_000)
    })
}

fn join_pipe(reader: Option<std::thread::JoinHandle<String>>) -> String {
    reader
        .and_then(|handle| handle.join().ok())
        .unwrap_or_default()
}

#[cfg(unix)]
fn kill_process_tree(child: &mut Child) {
    let process_group = i32::try_from(child.id()).unwrap_or(i32::MAX);
    // The child is spawned into its own process group above, so this terminates descendants too.
    unsafe {
        libc::killpg(process_group, libc::SIGKILL);
    }
    let _ = child.kill();
}

#[cfg(windows)]
fn kill_process_tree(child: &mut Child) {
    let _ = StdCommand::new("taskkill")
        .args(["/PID", &child.id().to_string(), "/T", "/F"])
        .status();
    let _ = child.kill();
}

fn truncate_string(s: &str, max_len: usize) -> String {
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

/// Get git status for a directory.
#[tauri::command(async)]
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
#[tauri::command(async)]
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
#[tauri::command(async)]
pub(crate) fn fs_create_directory(path: String, workspace_root: String) -> Result<(), String> {
    let validated = validate_path_in_workspace(&path, &workspace_root)?;
    std::fs::create_dir_all(&validated).map_err(|error| error.to_string())
}

/// Get detailed file metadata.
#[tauri::command(async)]
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
#[tauri::command(async)]
pub(crate) fn fs_create_snapshot(
    app: AppHandle,
    file_path: String,
    run_id: String,
    workspace_root: String,
) -> Result<SnapshotResult, String> {
    validate_component_id("snapshot run id", &run_id)?;
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
        Some(copy_and_hash(&validated, &snapshot_path)?)
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
        "post_hash": Value::Null,
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

/// Seal a snapshot after a successful mutation with the resulting file hash.
/// Restore uses this hash to avoid overwriting edits made after the Agent run.
#[tauri::command(async)]
pub(crate) fn fs_seal_snapshot(
    app: AppHandle,
    snapshot_id: String,
    run_id: String,
    file_path: String,
    workspace_root: String,
) -> Result<(), String> {
    validate_component_id("snapshot run id", &run_id)?;
    validate_component_id("snapshot id", &snapshot_id)?;
    let target = validate_path_in_workspace(&file_path, &workspace_root)?;
    let data_dir = app_data_dir(&app)?;
    let meta_path = data_dir
        .join("snapshots")
        .join(&run_id)
        .join(format!("{snapshot_id}.json"));
    let meta_str =
        std::fs::read_to_string(&meta_path).map_err(|e| format!("snapshot not found: {e}"))?;
    let mut meta: serde_json::Value = serde_json::from_str(&meta_str).map_err(|e| e.to_string())?;
    let recorded_path = meta["file_path"]
        .as_str()
        .ok_or("invalid snapshot metadata")?;
    if Path::new(recorded_path) != target {
        return Err("snapshot target does not match requested file".to_owned());
    }
    let post_hash = if target.exists() {
        Value::String(hash_file(&target)?)
    } else {
        Value::Null
    };
    // Indexing assignment panics when a corrupted meta file parses to a non-object.
    let meta_object = meta.as_object_mut().ok_or("invalid snapshot metadata")?;
    meta_object.insert("post_hash".to_owned(), post_hash);
    std::fs::write(&meta_path, meta.to_string()).map_err(|e| e.to_string())
}

/// Restore a file from a snapshot.
#[tauri::command(async)]
pub(crate) fn fs_restore_snapshot(
    app: AppHandle,
    snapshot_id: String,
    run_id: String,
    file_path: String,
    workspace_root: String,
) -> Result<bool, String> {
    validate_component_id("snapshot run id", &run_id)?;
    validate_component_id("snapshot id", &snapshot_id)?;
    let data_dir = app_data_dir(&app)?;
    let snapshot_dir = data_dir.join("snapshots").join(&run_id);
    let meta_path = snapshot_dir.join(format!("{snapshot_id}.json"));
    let meta_str =
        std::fs::read_to_string(&meta_path).map_err(|e| format!("snapshot not found: {e}"))?;
    let meta: serde_json::Value = serde_json::from_str(&meta_str).map_err(|e| e.to_string())?;
    let recorded_snapshot_path = meta["snapshot_path"]
        .as_str()
        .ok_or("invalid snapshot metadata")?;
    // The meta file is writable by the agent itself (write_file), so the
    // recorded payload location must be re-confined to the app's snapshot
    // store — otherwise restore becomes an arbitrary-file-copy primitive.
    let snapshot_payload = confine_snapshot_payload(&data_dir, recorded_snapshot_path)?;
    let existed = meta["existed"].as_bool().unwrap_or(false);
    let target = validate_path_in_workspace(&file_path, &workspace_root)?;
    let recorded_path = meta["file_path"]
        .as_str()
        .ok_or("invalid snapshot metadata")?;
    if Path::new(recorded_path) != target {
        return Err("snapshot target does not match requested file".to_owned());
    }

    let current_hash = if target.exists() {
        Some(hash_file(&target)?)
    } else {
        None
    };
    let expected_hash = meta
        .get("post_hash")
        .ok_or("snapshot has not been sealed after mutation")?;
    let expected_hash = if expected_hash.is_null() {
        None
    } else {
        expected_hash.as_str().map(str::to_owned)
    };
    if current_hash != expected_hash {
        return Err(
            "file was modified after the Agent run — refusing to overwrite newer changes"
                .to_owned(),
        );
    }

    if existed {
        std::fs::copy(snapshot_payload, &target).map_err(|e| e.to_string())?;
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
    // Full subsec nanos: the %100000 truncation collided within ~100µs and
    // made one snapshot's metadata overwrite another's.
    format!("{}-{}", now.as_millis(), now.subsec_nanos())
}

/// Resolve a metadata-recorded snapshot payload path and enforce that it stays
/// inside the app's snapshots store. Symlinks are resolved by canonicalize.
fn confine_snapshot_payload(data_dir: &Path, recorded: &str) -> Result<PathBuf, String> {
    let store_root = std::fs::canonicalize(data_dir.join("snapshots"))
        .map_err(|error| format!("snapshot store is not accessible: {error}"))?;
    let payload = std::fs::canonicalize(recorded)
        .map_err(|error| format!("snapshot payload is not accessible: {error}"))?;
    if !payload.starts_with(&store_root) {
        return Err("snapshot payload is outside the snapshot store".to_owned());
    }
    Ok(payload)
}

/// Streamed FNV-1a over a file (init and multiplier match the historical
/// in-memory hasher, so sealed snapshot hashes stay comparable) — never holds
/// the whole file in memory.
fn hash_file(path: &Path) -> Result<String, String> {
    use std::io::Read as _;
    let mut file = std::fs::File::open(path).map_err(|e| e.to_string())?;
    let mut hash: u64 = 0xcbf29ce484222325;
    let mut buffer = [0u8; 64 * 1024];
    loop {
        let read = file.read(&mut buffer).map_err(|e| e.to_string())?;
        if read == 0 {
            break;
        }
        for &byte in &buffer[..read] {
            hash ^= byte as u64;
            hash = hash.wrapping_mul(0x100000001b3);
        }
    }
    Ok(format!("{:016x}", hash))
}

/// Chunked copy that hashes while streaming, so snapshotting a huge file
/// cannot OOM the app.
fn copy_and_hash(source: &Path, destination: &Path) -> Result<String, String> {
    use std::io::{Read as _, Write as _};
    let mut input = std::fs::File::open(source).map_err(|e| e.to_string())?;
    let mut output = std::fs::File::create(destination).map_err(|e| e.to_string())?;
    let mut hash: u64 = 0xcbf29ce484222325;
    let mut buffer = [0u8; 64 * 1024];
    loop {
        let read = input.read(&mut buffer).map_err(|e| e.to_string())?;
        if read == 0 {
            break;
        }
        for &byte in &buffer[..read] {
            hash ^= byte as u64;
            hash = hash.wrapping_mul(0x100000001b3);
        }
        output
            .write_all(&buffer[..read])
            .map_err(|e| e.to_string())?;
    }
    output.sync_all().map_err(|e| e.to_string())?;
    Ok(format!("{:016x}", hash))
}

fn system_time_now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .ok()
        .and_then(|v| u64::try_from(v.as_millis()).ok())
        .unwrap_or(0)
}

/// True when a semicolon inside SQL text separates real statements (a second
/// statement would be silently dropped by prepare/execute without the
/// `extra_check` feature, so reject it here). String/blob literals and
/// comments are skipped; identifiers cannot contain raw semicolons.
fn has_statement_tail(sql: &str) -> bool {
    let bytes = sql.as_bytes();
    let mut index = 0;
    while index < bytes.len() {
        let byte = bytes[index];
        match byte {
            b'\'' | b'"' => {
                let quote = byte;
                index += 1;
                while index < bytes.len() {
                    if bytes[index] == quote {
                        if index + 1 < bytes.len() && bytes[index + 1] == quote {
                            index += 2; // escaped quote
                            continue;
                        }
                        break;
                    }
                    index += 1;
                }
            }
            b'-' if index + 1 < bytes.len() && bytes[index + 1] == b'-' => {
                while index < bytes.len() && bytes[index] != b'\n' {
                    index += 1;
                }
            }
            b'/' if index + 1 < bytes.len() && bytes[index + 1] == b'*' => {
                index += 2;
                while index + 1 < bytes.len() && !(bytes[index] == b'*' && bytes[index + 1] == b'/')
                {
                    index += 1;
                }
            }
            b';' => {
                // Skip whitespace and comments after the separator: a trailing
                // comment is not a second statement.
                let mut rest = &sql[index + 1..];
                loop {
                    rest = rest.trim_start();
                    if let Some(stripped) = rest.strip_prefix("--") {
                        let consumed = stripped.len();
                        let after = &rest[consumed..];
                        let newline = after.find('\n').unwrap_or(after.len());
                        rest = &after[newline..];
                    } else if rest.starts_with("/*") {
                        let end = rest.find("*/").map(|at| at + 2).unwrap_or(rest.len());
                        rest = &rest[end..];
                    } else {
                        break;
                    }
                }
                if !rest.is_empty() {
                    return true;
                }
            }
            _ => {}
        }
        index += 1;
    }
    false
}

fn validate_query_sql(sql: &str) -> Result<(), String> {
    let trimmed = sql.trim().to_uppercase();
    if !trimmed.starts_with("SELECT")
        && !trimmed.starts_with("WITH")
        && !trimmed.starts_with("PRAGMA")
    {
        return Err("only SELECT, WITH, and PRAGMA queries are allowed".to_owned());
    }
    if trimmed.starts_with("PRAGMA") {
        // sqlite3_stmt_readonly() reports TRUE for some writing pragmas
        // (writable_schema), so pragmas get their own read-only allowlist;
        // an '=' argument makes even an allowlisted pragma a write.
        const READ_ONLY_PRAGMAS: &[&str] = &[
            "table_info",
            "index_list",
            "index_xinfo",
            "table_list",
            "pragma_list",
            "foreign_keys",
            "journal_mode",
            "page_count",
            "page_size",
            "encoding",
            "user_version",
            "integrity_check",
            "quick_check",
        ];
        let lowered = sql.trim_start().to_lowercase();
        let rest = lowered
            .strip_prefix("pragma")
            .unwrap_or(&lowered)
            .trim_start();
        let name = rest
            .split(|c: char| c.is_whitespace() || c == '(' || c == '=' || c == ';')
            .next()
            .unwrap_or("");
        if !READ_ONLY_PRAGMAS.contains(&name) {
            return Err("only read-only PRAGMA queries are allowed".to_owned());
        }
        if rest.contains('=') {
            return Err("PRAGMA arguments are not allowed".to_owned());
        }
    }
    if has_statement_tail(sql) {
        return Err("only a single statement is allowed".to_owned());
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
    if has_statement_tail(sql) {
        return Err("only a single statement is allowed".to_owned());
    }
    // No keyword substring scan: it false-positives on identifiers like a
    // "drop_reason" column, and the single-statement + prefix rules above are
    // the actual boundary.
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{
        cancel_command, confine_snapshot_payload, fs_read_file, merge_shared_provider_profiles,
        read_pipe, run_command_blocking, truncate_string, validate_component_id, validate_entity,
        validate_path, validate_path_in_workspace, validate_query_sql, validate_shared_provider,
        validate_update_sql, SharedProviderProfile, STRUCTURED_ENTITIES,
    };

    struct CountingReader {
        remaining: usize,
        consumed: std::sync::Arc<std::sync::atomic::AtomicUsize>,
    }

    struct InterruptedOnceReader {
        interrupted: bool,
        inner: CountingReader,
    }

    impl std::io::Read for InterruptedOnceReader {
        fn read(&mut self, buffer: &mut [u8]) -> std::io::Result<usize> {
            if !self.interrupted {
                self.interrupted = true;
                return Err(std::io::Error::from(std::io::ErrorKind::Interrupted));
            }
            self.inner.read(buffer)
        }
    }

    impl std::io::Read for CountingReader {
        fn read(&mut self, buffer: &mut [u8]) -> std::io::Result<usize> {
            let read = self.remaining.min(buffer.len());
            buffer[..read].fill(b'x');
            self.remaining -= read;
            self.consumed
                .fetch_add(read, std::sync::atomic::Ordering::SeqCst);
            Ok(read)
        }
    }

    #[test]
    fn command_pipe_is_fully_drained_after_output_capture_limit() {
        use std::sync::atomic::Ordering;

        let consumed = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let output = read_pipe(CountingReader {
            remaining: 300_000,
            consumed: std::sync::Arc::clone(&consumed),
        })
        .join()
        .expect("pipe reader should finish");

        assert_eq!(consumed.load(Ordering::SeqCst), 300_000);
        assert!(output.len() <= 50_100);
        assert!(output.contains("truncated"));
    }

    #[test]
    fn command_pipe_retries_interrupted_reads() {
        use std::sync::atomic::Ordering;

        let consumed = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let output = read_pipe(InterruptedOnceReader {
            interrupted: false,
            inner: CountingReader {
                remaining: 16,
                consumed: std::sync::Arc::clone(&consumed),
            },
        })
        .join()
        .expect("pipe reader should finish");

        assert_eq!(consumed.load(Ordering::SeqCst), 16);
        assert_eq!(output, "xxxxxxxxxxxxxxxx");
    }

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
    fn shared_provider_validation_rejects_secrets_and_unsupported_protocols() {
        let profile = SharedProviderProfile {
            id: "provider-1".to_owned(),
            name: "Provider".to_owned(),
            protocol_id: "openai-compatible-chat".to_owned(),
            base_url: "https://example.com/v1".to_owned(),
            model_id: "model".to_owned(),
            tool_calling: true,
            max_context_tokens: Some(32_768),
            enabled: true,
            is_default: true,
            created_at: 1,
            updated_at: 2,
        };
        assert!(validate_shared_provider(&profile).is_ok());
        let encoded = serde_json::to_string(&profile).expect("profile should serialize");
        assert!(!encoded.contains("apiKey"));
        assert!(encoded.contains("maxContextTokens"));
        let with_secret = encoded.trim_end_matches('}').to_owned() + ",\"apiKey\":\"secret\"}";
        assert!(serde_json::from_str::<SharedProviderProfile>(&with_secret).is_err());

        let mut unsupported = profile;
        unsupported.protocol_id = "unknown".to_owned();
        assert_eq!(
            validate_shared_provider(&unsupported),
            Err("unsupported provider protocol".to_owned())
        );

        let without_context = SharedProviderProfile {
            max_context_tokens: None,
            ..unsupported
        };
        let encoded = serde_json::to_string(&without_context).expect("profile should serialize");
        assert!(!encoded.contains("maxContextTokens"));
    }

    #[test]
    fn shared_provider_merge_preserves_newer_disk_values_and_explicit_deletions() {
        let profile = |id: &str, updated_at: u64, is_default: bool| SharedProviderProfile {
            id: id.to_owned(),
            name: format!("Provider {id}"),
            protocol_id: "openai-compatible-chat".to_owned(),
            base_url: "https://example.com/v1".to_owned(),
            model_id: format!("model-{updated_at}"),
            tool_calling: true,
            max_context_tokens: None,
            enabled: true,
            is_default,
            created_at: 1,
            updated_at,
        };
        let merged = merge_shared_provider_profiles(
            vec![
                profile("newer-on-disk", 20, true),
                profile("deleted", 5, false),
            ],
            vec![
                profile("newer-on-disk", 10, false),
                profile("incoming", 30, true),
            ],
            vec!["deleted".to_owned()],
        )
        .expect("profiles should merge");

        assert_eq!(merged.len(), 2);
        assert_eq!(merged[0].id, "incoming");
        assert!(merged[0].is_default);
        assert_eq!(merged[1].model_id, "model-20");
        assert!(!merged[1].is_default);
    }

    #[cfg(unix)]
    #[test]
    fn running_command_can_be_cancelled() {
        let workspace =
            std::env::temp_dir().join(format!("evir-command-cancel-{}", std::process::id()));
        std::fs::create_dir_all(&workspace).expect("workspace should be created");
        let cwd = workspace.to_string_lossy().into_owned();
        let workspace_root = cwd.clone();
        let command_id = "cancel-test-command".to_owned();
        let worker_id = command_id.clone();
        let worker = std::thread::spawn(move || {
            run_command_blocking(
                worker_id,
                cwd,
                "sh".to_owned(),
                vec!["-c".to_owned(), "sleep 10 & wait".to_owned()],
                Some(15_000),
                None,
                workspace_root,
            )
        });

        let started = std::time::Instant::now();
        loop {
            if cancel_command(command_id.clone()).expect("cancel command should succeed") {
                break;
            }
            assert!(
                started.elapsed() < std::time::Duration::from_secs(2),
                "command did not register for cancellation"
            );
            std::thread::sleep(std::time::Duration::from_millis(10));
        }

        let result = worker
            .join()
            .expect("command thread should join")
            .expect("command should return a result");
        assert!(!result.success);
        assert_eq!(result.stderr, "Command cancelled by user");
        assert!(started.elapsed() < std::time::Duration::from_secs(3));
        let _ = std::fs::remove_dir_all(workspace);
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
    fn read_pipe_caps_output_size() {
        let huge = vec![b'x'; 500_000];
        let joined = read_pipe(std::io::Cursor::new(huge))
            .join()
            .expect("pipe reader should finish");
        assert!(joined.contains("... truncated (200000 bytes total)"));
        assert!(joined.len() < 60_000);
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

    #[test]
    fn confine_snapshot_payload_stays_inside_store() {
        let base = std::env::temp_dir().join(format!("evir-confine-{}", std::process::id()));
        let store = base.join("snapshots").join("run-1");
        std::fs::create_dir_all(&store).expect("store should be created");
        let payload = store.join("1690000000-1_file.txt");
        std::fs::write(&payload, b"content").expect("payload should be written");
        let outside = base.join("outside.txt");
        std::fs::write(&outside, b"secret").expect("outside file should be written");

        let confined = confine_snapshot_payload(&base, payload.to_str().expect("valid utf8 path"))
            .expect("inside payload should be accepted");
        assert_eq!(
            confined,
            std::fs::canonicalize(&payload).expect("canonical")
        );
        assert!(
            confine_snapshot_payload(&base, outside.to_str().expect("valid utf8 path")).is_err(),
            "payload outside the store must be rejected"
        );
        let _ = std::fs::remove_dir_all(base);
    }

    #[test]
    fn query_validation_allows_read_statements_only() {
        for sql in [
            "SELECT * FROM messages",
            " with recent AS (SELECT 1) SELECT * FROM recent",
            "pragma table_info(messages)",
            "SELECT ';' AS sep",
            "SELECT 1; -- trailing comment only",
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
        // A second statement must error instead of being silently dropped.
        assert_eq!(
            validate_query_sql("SELECT 1; DROP TABLE messages"),
            Err("only a single statement is allowed".to_owned())
        );
        assert!(validate_query_sql("SELECT 1; INSERT INTO settings VALUES (1, 'x')").is_err());
        // sqlite reports some writing pragmas as readonly; the allowlist is the guard.
        assert!(validate_query_sql("PRAGMA writable_schema = 1").is_err());
        assert!(validate_query_sql("pragma journal_mode = WAL").is_err());
        assert!(validate_query_sql("PRAGMA table_info(messages)").is_ok());
    }

    #[test]
    fn update_validation_allows_single_dml_statements() {
        for sql in [
            "INSERT INTO settings VALUES (?1, ?2)",
            " update settings SET value = ?1",
            "DELETE FROM settings WHERE name = ?1",
            "UPDATE settings SET value = 'contains; semicolon' WHERE name = ?1",
        ] {
            assert!(
                validate_update_sql(sql).is_ok(),
                "expected update to pass: {sql}"
            );
        }
        assert!(validate_update_sql("DROP TABLE settings").is_err());
        assert_eq!(
            validate_update_sql("DELETE FROM settings; VACUUM"),
            Err("only a single statement is allowed".to_owned())
        );
        // Identifiers that merely contain a scary substring must not be rejected.
        assert!(validate_update_sql("UPDATE tickets SET drop_reason = ?1 WHERE id = ?2").is_ok());
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

fn run_git(root: &std::path::Path, args: &[&str]) -> Result<String, String> {
    let output = std::process::Command::new("git")
        .arg("-C")
        .arg(root)
        .args(args)
        .output()
        .map_err(|error| error.to_string())?;
    if !output.status.success() {
        return Err(format!(
            "git {:?} failed: {}",
            args,
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}

/// Create an isolated git worktree for parallel write execution. Returns the
/// worktree path. Fails cleanly when the root is not a git repository.
#[tauri::command(async)]
pub(crate) fn git_worktree_create(root: String, id: String) -> Result<String, String> {
    validate_component_id("worktree id", &id)?;
    let root_path = validate_path(&root)?;
    if !root_path.join(".git").exists() {
        run_git(&root_path, &["rev-parse", "--git-dir"])?;
    }
    let worktrees = root_path.join(".evir-worktrees");
    std::fs::create_dir_all(&worktrees).map_err(|error| error.to_string())?;
    let branch = format!("evir/{}", id);
    let path = worktrees.join(&id);
    run_git(
        &root_path,
        &[
            "worktree",
            "add",
            "-b",
            &branch,
            path.to_string_lossy().as_ref(),
        ],
    )?;
    Ok(path.to_string_lossy().into_owned())
}

/// Stage everything inside the worktree and apply the resulting patch back to
/// the main working tree with a three-way merge. Any conflict fails the merge.
#[tauri::command(async)]
pub(crate) fn git_worktree_merge(root: String, id: String) -> Result<(), String> {
    validate_component_id("worktree id", &id)?;
    let root_path = validate_path(&root)?;
    let worktree = root_path.join(".evir-worktrees").join(&id);
    run_git(&worktree, &["add", "-A"])?;
    let patch = run_git(&worktree, &["diff", "--cached", "--binary"])?;
    if patch.trim().is_empty() {
        return Ok(());
    }
    let patch_path = worktree.join(".evir-merge.patch");
    std::fs::write(&patch_path, &patch).map_err(|error| error.to_string())?;
    // NB: the flag is `--3way` (no second hyphen); `--3-way` is an unknown
    // option, which made every real worktree merge fail until this test.
    let applied = std::process::Command::new("git")
        .arg("-C")
        .arg(&root_path)
        .args(["apply", "--3way"])
        .arg(&patch_path)
        .output()
        .map_err(|error| error.to_string())?;
    let _ = std::fs::remove_file(&patch_path);
    if !applied.status.success() {
        return Err(format!(
            "worktree merge conflict: {}",
            String::from_utf8_lossy(&applied.stderr).trim()
        ));
    }
    Ok(())
}

#[tauri::command(async)]
pub(crate) fn git_worktree_remove(root: String, id: String) -> Result<(), String> {
    validate_component_id("worktree id", &id)?;
    let root_path = validate_path(&root)?;
    let worktree = root_path.join(".evir-worktrees").join(&id);
    let _ = run_git(
        &root_path,
        &[
            "worktree",
            "remove",
            "--force",
            worktree.to_string_lossy().as_ref(),
        ],
    );
    let _ = run_git(&root_path, &["branch", "-D", &format!("evir/{}", id)]);
    Ok(())
}

#[cfg(test)]
mod worktree_tests {
    use super::{git_worktree_create, git_worktree_merge, git_worktree_remove};

    fn git_available() -> bool {
        std::process::Command::new("git")
            .arg("--version")
            .output()
            .map(|output| output.status.success())
            .unwrap_or(false)
    }

    fn init_repo(root: &std::path::Path) {
        let run = |args: &[&str]| {
            let output = std::process::Command::new("git")
                .arg("-C")
                .arg(root)
                .args(args)
                .output()
                .expect("git must spawn");
            assert!(
                output.status.success(),
                "git {:?} failed: {}",
                args,
                String::from_utf8_lossy(&output.stderr)
            );
        };
        run(&["init", "--initial-branch=main"]);
        run(&["config", "user.email", "test@evir.local"]);
        run(&["config", "user.name", "Evir Test"]);
        std::fs::write(root.join("README.md"), "base\n").expect("seed file");
        run(&["add", "-A"]);
        run(&["commit", "-m", "init"]);
    }

    #[test]
    fn worktree_create_merge_remove_round_trip() {
        if !git_available() {
            eprintln!("skipping: git binary not available");
            return;
        }
        let suffix = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        let root =
            std::env::temp_dir().join(format!("evir-worktree-{}-{suffix}", std::process::id()));
        std::fs::create_dir_all(&root).expect("repo dir");
        init_repo(&root);
        let root_str = root.to_string_lossy().into_owned();

        // Create → isolated checkout exists with the committed file.
        let worktree = git_worktree_create(root_str.clone(), "wt-test-1".to_owned())
            .expect("worktree must be created");
        assert!(std::path::Path::new(&worktree).join("README.md").exists());
        assert!(worktree.contains(".evir-worktrees"));

        // Merge → writes made inside the worktree land in the main tree.
        std::fs::write(
            std::path::Path::new(&worktree).join("feature.txt"),
            "isolated write\n",
        )
        .expect("worktree write");
        git_worktree_merge(root_str.clone(), "wt-test-1".to_owned())
            .expect("merge must apply the patch");
        assert!(root.join("feature.txt").exists());

        // Remove → the worktree directory and its branch are cleaned up.
        git_worktree_remove(root_str, "wt-test-1".to_owned()).expect("worktree must be removed");
        assert!(!std::path::Path::new(&worktree).exists());

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn worktree_create_fails_outside_a_git_repository() {
        let suffix = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        let root = std::env::temp_dir().join(format!("evir-nowt-{}-{suffix}", std::process::id()));
        std::fs::create_dir_all(&root).expect("plain dir");
        let error = git_worktree_create(root.to_string_lossy().into_owned(), "wt-plain".to_owned())
            .expect_err("non-repo must fail");
        assert!(error.contains("failed"), "unexpected error: {error}");
        let _ = std::fs::remove_dir_all(&root);
    }
}
