//! Filesystem commands: text and base64 reads, atomic writes, directory
//! listing, file info/stat, real-path resolution, patch application, and
//! name-based search — all confined to the selected workspace through
//! `validate_path_in_workspace`.

use std::{path::Path, time::UNIX_EPOCH};

use serde::Serialize;

use super::infra::{is_symlink, validate_path, validate_path_in_workspace, write_file_atomically};

#[derive(Serialize)]
pub struct FileInfo {
    name: String,
    path: String,
    is_dir: bool,
    size: u64,
    modified: Option<u64>,
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

/// Binary-safe read for preview renderers (images, PDFs) inside the
/// workspace. Returns standard base64; 8 MiB cap keeps the IPC bounded.
#[tauri::command(async)]
pub(crate) fn fs_read_file_base64(path: String, workspace_root: String) -> Result<String, String> {
    use base64::Engine as _;
    use std::io::Read as _;
    const MAX_READ_BYTES: u64 = 8 << 20;
    let mut file = std::fs::File::open(validate_path_in_workspace(&path, &workspace_root)?)
        .map_err(|error| error.to_string())?;
    let mut bytes = Vec::with_capacity(8192);
    (&mut file)
        .take(MAX_READ_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| error.to_string())?;
    if bytes.len() as u64 > MAX_READ_BYTES {
        return Err("file too large for preview".into());
    }
    Ok(base64::engine::general_purpose::STANDARD.encode(bytes))
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

/// Reveal a workspace file in the platform file manager (Finder/Explorer),
/// with the file selected where the OS supports it. Read-only convenience for
/// the preview header and output rows; the path is workspace-validated like
/// every other fs command.
#[tauri::command(async)]
pub(crate) fn fs_reveal_in_file_manager(
    path: String,
    workspace_root: String,
) -> Result<(), String> {
    let validated = validate_path_in_workspace(&path, &workspace_root)?;
    if !validated.exists() {
        return Err("path does not exist".into());
    }
    #[cfg(target_os = "macos")]
    let spawn = std::process::Command::new("open")
        .arg("-R")
        .arg(&validated)
        .spawn();

    #[cfg(target_os = "windows")]
    let spawn = std::process::Command::new("explorer")
        .arg(format!("/select,{}", validated.display()))
        .spawn();

    #[cfg(all(unix, not(target_os = "macos")))]
    let spawn = std::process::Command::new("xdg-open")
        .arg(validated.parent().unwrap_or(&validated))
        .spawn();

    spawn.map(|_| ()).map_err(|error| error.to_string())
}
