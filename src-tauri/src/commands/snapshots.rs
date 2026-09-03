//! File snapshot commands: create a pre-mutation snapshot under the app data
//! dir, seal it with the post-mutation hash, and restore it — with payload
//! confinement and streamed hashing so large files cannot OOM the app.

use std::path::{Path, PathBuf};

use serde::Serialize;
use serde_json::Value;
use tauri::AppHandle;

use super::infra::{
    app_data_dir, system_time_now_ms, uuid_string, validate_component_id,
    validate_path_in_workspace,
};

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

#[cfg(test)]
mod tests {
    use super::confine_snapshot_payload;

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
}
