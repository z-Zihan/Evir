use std::{
    fs::{self, File},
    io::Write,
    path::{Path, PathBuf},
};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Manager};
use zip::{write::SimpleFileOptions, CompressionMethod, ZipWriter};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MetadataFile {
    pub name: String,
    pub contents: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LogFileInfo {
    pub name: String,
    pub bytes: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LogsOverview {
    pub files: Vec<LogFileInfo>,
    pub total_bytes: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticsExportResult {
    pub zip_path: String,
    pub file_count: u32,
    pub total_bytes: u64,
    pub log_files: Vec<LogFileInfo>,
    pub manifest: Value,
}

/// `app-YYYY-MM-DD(.N)?.jsonl` where the category is app/audit/performance.
pub(crate) fn parse_log_file_name(name: &str) -> Option<(&str, &str)> {
    let (category, rest) = name.split_once('-')?;
    if !matches!(category, "app" | "audit" | "performance") {
        return None;
    }
    let date = rest.get(0..10)?;
    let valid_date = date.len() == 10
        && date.as_bytes()[4] == b'-'
        && date.as_bytes()[7] == b'-'
        && date
            .bytes()
            .enumerate()
            .all(|(i, b)| i == 4 || i == 7 || b.is_ascii_digit());
    if !valid_date {
        return None;
    }
    let tail = &rest[10..];
    let valid_tail = tail == ".jsonl" || (tail.starts_with('.') && tail.ends_with(".jsonl"));
    if !valid_tail {
        return None;
    }
    Some((category, date))
}

pub(crate) fn collect_log_files(logs_dir: &Path, from_day: Option<&str>) -> Vec<LogFileInfo> {
    let Ok(entries) = fs::read_dir(logs_dir) else {
        return Vec::new();
    };
    let mut files: Vec<LogFileInfo> = entries
        .flatten()
        .filter_map(|entry| {
            let name = entry.file_name().to_string_lossy().into_owned();
            let (_, date) = parse_log_file_name(&name)?;
            if let Some(from) = from_day {
                if date < from {
                    return None;
                }
            }
            let bytes = entry.metadata().ok().map(|meta| meta.len()).unwrap_or(0);
            Some(LogFileInfo { name, bytes })
        })
        .collect();
    files.sort_by(|a, b| a.name.cmp(&b.name));
    files
}

pub(crate) fn is_safe_metadata_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 64
        && name.ends_with(".json")
        && name
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'.' || b == b'-' || b == b'_')
}

/// Civil date from days since the Unix epoch (Howard Hinnant's algorithm).
fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146_096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (if m <= 2 { y + 1 } else { y }, m, d)
}

pub(crate) fn iso8601_utc(millis: u64) -> String {
    let seconds = millis / 1000;
    let days = (seconds / 86_400) as i64;
    let secs_of_day = seconds % 86_400;
    let (year, month, day) = civil_from_days(days);
    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}.{:03}Z",
        secs_of_day / 3600,
        (secs_of_day % 3600) / 60,
        secs_of_day % 60,
        millis % 1000
    )
}

fn write_crash_reports(
    zip: &mut ZipWriter<File>,
    options: SimpleFileOptions,
    logs_dir: &Path,
) -> u32 {
    let crash_dir = logs_dir.join("crash");
    let Ok(entries) = fs::read_dir(&crash_dir) else {
        return 0;
    };
    let mut written = 0;
    for entry in entries.flatten() {
        let Ok(name) = entry.file_name().into_string() else {
            continue;
        };
        if let Ok(bytes) = fs::read(entry.path()) {
            if zip.start_file(format!("crash/{name}"), options).is_ok()
                && zip.write_all(&bytes).is_ok()
            {
                written += 1;
            }
        }
    }
    written
}

/// Builds the diagnostics ZIP. Pure filesystem work so tests can run without a
/// Tauri app handle; the command wrappers only resolve paths and version.
pub(crate) fn export_zip_to_path(
    logs_dir: &Path,
    dest_path: &Path,
    metadata_files: &[MetadataFile],
    from_day: Option<&str>,
    include_crash_reports: bool,
    app_version: &str,
) -> Result<DiagnosticsExportResult, String> {
    for metadata in metadata_files {
        if !is_safe_metadata_name(&metadata.name) {
            return Err(format!("invalid metadata file name: {}", metadata.name));
        }
    }
    let log_files = collect_log_files(logs_dir, from_day);

    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0);
    let mut entries = vec![json!({ "name": "manifest.json" })];
    entries.extend(
        metadata_files
            .iter()
            .map(|file| json!({ "name": file.name, "bytes": file.contents.len() })),
    );
    entries.extend(
        log_files
            .iter()
            .map(|file| json!({ "name": format!("logs/{}", file.name), "bytes": file.bytes })),
    );
    let manifest = json!({
        "format": "evir-diagnostics/1",
        "generatedAt": iso8601_utc(now_ms),
        "appVersion": app_version,
        "platform": format!("{}-{}", std::env::consts::OS, std::env::consts::ARCH),
        "includesCrashReports": include_crash_reports,
        "entries": entries,
    });

    let output = File::create(dest_path).map_err(|error| format!("create zip: {error}"))?;
    let mut zip = ZipWriter::new(output);
    let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);

    zip.start_file("manifest.json", options)
        .map_err(|error| format!("write manifest: {error}"))?;
    zip.write_all(manifest.to_string().as_bytes())
        .map_err(|error| format!("write manifest: {error}"))?;

    let mut metadata_bytes = 0u64;
    let mut file_count = 1u32;
    for metadata in metadata_files {
        zip.start_file(metadata.name.as_str(), options)
            .map_err(|error| format!("write {}: {error}", metadata.name))?;
        zip.write_all(metadata.contents.as_bytes())
            .map_err(|error| format!("write {}: {error}", metadata.name))?;
        metadata_bytes += metadata.contents.len() as u64;
        file_count += 1;
    }

    let mut log_bytes = 0u64;
    for log_file in &log_files {
        let path: PathBuf = logs_dir.join(&log_file.name);
        let contents =
            fs::read(&path).map_err(|error| format!("read {}: {error}", log_file.name))?;
        zip.start_file(format!("logs/{}", log_file.name), options)
            .map_err(|error| format!("write {}: {error}", log_file.name))?;
        zip.write_all(&contents)
            .map_err(|error| format!("write {}: {error}", log_file.name))?;
        log_bytes += contents.len() as u64;
        file_count += 1;
    }

    if include_crash_reports {
        file_count += write_crash_reports(&mut zip, options, logs_dir);
    }

    zip.finish()
        .map_err(|error| format!("finish zip: {error}"))?;

    Ok(DiagnosticsExportResult {
        zip_path: dest_path.to_string_lossy().into_owned(),
        file_count,
        total_bytes: metadata_bytes + log_bytes,
        log_files,
        manifest,
    })
}

#[tauri::command(async)]
pub fn diagnostics_logs_overview(
    app: AppHandle,
    from_day: Option<String>,
) -> Result<LogsOverview, String> {
    let logs_dir = logs_directory(&app)?;
    let files = collect_log_files(&logs_dir, from_day.as_deref());
    let total_bytes = files.iter().map(|file| file.bytes).sum();
    Ok(LogsOverview { files, total_bytes })
}

#[tauri::command(async)]
pub async fn diagnostics_export_zip(
    app: AppHandle,
    dest_path: String,
    metadata_files: Vec<MetadataFile>,
    from_day: Option<String>,
    include_crash_reports: bool,
) -> Result<DiagnosticsExportResult, String> {
    // The destination comes over IPC; every other write path in the app goes
    // through validate_path, this one must not accept junk either.
    let dest = PathBuf::from(&dest_path);
    if !dest.is_absolute() {
        return Err("diagnostics export destination must be an absolute path".to_owned());
    }
    let parent = dest
        .parent()
        .ok_or_else(|| "invalid diagnostics export destination".to_owned())?;
    if !parent.is_dir() {
        return Err(format!(
            "diagnostics export destination directory does not exist: {}",
            parent.display()
        ));
    }
    if dest.is_dir() {
        return Err("diagnostics export destination is a directory".to_owned());
    }
    let logs_dir = logs_directory(&app)?;
    let app_version = app.package_info().version.to_string();
    // Zipping can walk hundreds of MB of logs; keep it off the app main thread.
    tauri::async_runtime::spawn_blocking(move || {
        export_zip_to_path(
            &logs_dir,
            &dest,
            &metadata_files,
            from_day.as_deref(),
            include_crash_reports,
            &app_version,
        )
    })
    .await
    .map_err(|error| error.to_string())?
}

fn logs_directory(app: &AppHandle) -> Result<PathBuf, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("resolve app data dir: {error}"))?;
    Ok(data_dir.join("logs"))
}
