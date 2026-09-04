//! Plugin install surface (§43-44): the ONLY host file access plugins get in
//! v1 is a validated read of `<folder>/manifest.json` at install time.
//! Nothing from the folder is read afterwards (contributions are declared
//! inline in the manifest), so there is no runtime traversal surface.

use std::path::{Component, Path, PathBuf};

const MANIFEST_MAX_BYTES: u64 = 128 * 1024;

/// Reject traversal/relative shapes before touching the filesystem.
fn valid_absolute_folder(folder: &str) -> Result<PathBuf, String> {
    let path = Path::new(folder);
    if !path.is_absolute() {
        return Err("plugin folder must be an absolute path".to_string());
    }
    let mut components = path.components();
    let normal = components.by_ref().all(|component| {
        matches!(
            component,
            Component::Normal(_) | Component::Prefix(_) | Component::RootDir
        )
    }) && !folder.contains("..");
    if !normal {
        return Err("plugin folder must not contain traversal segments".to_string());
    }
    Ok(path.to_path_buf())
}

#[tauri::command(async)]
pub(crate) fn plugin_read_manifest(folder: String) -> Result<String, String> {
    let base = valid_absolute_folder(&folder)?;
    if !base.is_dir() {
        return Err("plugin folder does not exist".to_string());
    }
    // Canonicalize the folder, then read exactly <folder>/manifest.json and
    // verify the resolved file really lives in that folder (symlink defense).
    let canonical_base = base
        .canonicalize()
        .map_err(|error| format!("resolve plugin folder: {error}"))?;
    let manifest_path = canonical_base.join("manifest.json");
    let canonical_manifest = manifest_path
        .canonicalize()
        .map_err(|error| format!("resolve manifest.json: {error}"))?;
    if canonical_manifest.parent() != Some(canonical_base.as_path()) {
        return Err("manifest.json must live directly in the plugin folder".to_string());
    }
    let metadata = std::fs::metadata(&canonical_manifest)
        .map_err(|error| format!("read manifest.json: {error}"))?;
    if !metadata.is_file() {
        return Err("manifest.json is not a file".to_string());
    }
    if metadata.len() > MANIFEST_MAX_BYTES {
        return Err("manifest.json exceeds 128 KiB".to_string());
    }
    std::fs::read_to_string(&canonical_manifest)
        .map_err(|error| format!("read manifest.json: {error}"))
}
