use std::fs;
use std::path::{Path, PathBuf};

use serde_json::Value;
use zip::read::ZipArchive;

use super::diagnostics::{
    collect_log_files, is_safe_metadata_name, iso8601_utc, parse_log_file_name, MetadataFile,
};

fn temp_dir(tag: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "evir-diagnostics-test-{tag}-{}",
        std::process::id()
    ));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).expect("create temp dir");
    dir
}

fn write_logs(dir: &Path) {
    fs::write(dir.join("app-2026-08-20.jsonl"), "{\"event\":\"a\"}\n").expect("write app log");
    fs::write(dir.join("audit-2026-08-21.1.jsonl"), "{\"event\":\"b\"}\n")
        .expect("write audit log");
    fs::write(dir.join("app-2020-01-01.jsonl"), "{\"event\":\"old\"}\n").expect("write old log");
    fs::write(dir.join("notes.txt"), "not a log").expect("write non-log file");
}

#[test]
fn parses_log_file_names() {
    assert_eq!(
        parse_log_file_name("app-2026-08-20.jsonl"),
        Some(("app", "2026-08-20"))
    );
    assert_eq!(
        parse_log_file_name("performance-2026-08-21.12.jsonl"),
        Some(("performance", "2026-08-21"))
    );
    assert_eq!(parse_log_file_name("notes.txt"), None);
    assert_eq!(parse_log_file_name("app-2026-8-20.jsonl"), None);
    assert_eq!(parse_log_file_name("other-2026-08-20.jsonl"), None);
    assert_eq!(parse_log_file_name("app-2026-08-20.log"), None);
}

#[test]
fn formats_iso8601_timestamps() {
    assert_eq!(iso8601_utc(0), "1970-01-01T00:00:00.000Z");
    // 2026-08-27T00:00:00Z == 1789881600 seconds.
    assert_eq!(iso8601_utc(1_787_788_800_000), "2026-08-27T00:00:00.000Z");
    assert_eq!(iso8601_utc(86_399_999), "1970-01-01T23:59:59.999Z");
}

#[test]
fn collects_and_filters_log_files_by_day() {
    let dir = temp_dir("collect");
    write_logs(&dir);

    let all = collect_log_files(&dir, None);
    assert_eq!(all.len(), 3, "non-log and nothing else must be excluded");

    let recent = collect_log_files(&dir, Some("2026-08-01"));
    let names: Vec<&str> = recent.iter().map(|file| file.name.as_str()).collect();
    assert_eq!(
        names,
        vec!["app-2026-08-20.jsonl", "audit-2026-08-21.1.jsonl"]
    );
    assert!(recent.iter().all(|file| file.bytes > 0));

    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn validates_metadata_file_names() {
    assert!(is_safe_metadata_name("system.json"));
    assert!(is_safe_metadata_name("provider-metadata.json"));
    assert!(!is_safe_metadata_name("../evil.json"));
    assert!(!is_safe_metadata_name("a/b.json"));
    assert!(!is_safe_metadata_name("system.txt"));
    assert!(!is_safe_metadata_name(""));
}

#[test]
fn writes_zip_bundle_with_metadata_and_logs() {
    let logs_dir = temp_dir("zip-logs");
    write_logs(&logs_dir);
    let out_dir = temp_dir("zip-out");
    let zip_path = out_dir.join("bundle.zip");

    let metadata = vec![
        MetadataFile {
            name: "system.json".to_string(),
            contents: "{\"appVersion\":\"0.1.0\"}".to_string(),
        },
        MetadataFile {
            name: "provider-metadata.json".to_string(),
            contents: "{\"providers\":[]}".to_string(),
        },
    ];

    let result = super::diagnostics::export_zip_to_path(
        &logs_dir,
        &zip_path,
        &metadata,
        Some("2026-08-01"),
        false,
        "0.1.0",
    )
    .expect("export zip");

    assert_eq!(
        result.file_count, 5,
        "manifest + 2 metadata + 2 recent logs"
    );
    assert!(result.zip_path.ends_with("bundle.zip"));

    let file = fs::File::open(&zip_path).expect("open zip");
    let mut archive = ZipArchive::new(file).expect("read zip archive");
    let mut names: Vec<String> = (0..archive.len())
        .map(|index| {
            let entry = archive.by_index(index).expect("entry");
            entry.name().to_string()
        })
        .collect();
    names.sort();
    assert_eq!(
        names,
        vec![
            "logs/app-2026-08-20.jsonl".to_string(),
            "logs/audit-2026-08-21.1.jsonl".to_string(),
            "manifest.json".to_string(),
            "provider-metadata.json".to_string(),
            "system.json".to_string(),
        ]
    );

    {
        let mut system = archive.by_name("system.json").expect("system entry");
        let mut contents = String::new();
        std::io::Read::read_to_string(&mut system, &mut contents).expect("read system.json");
        assert_eq!(contents, "{\"appVersion\":\"0.1.0\"}");
    }

    let mut manifest_raw = String::new();
    {
        let mut manifest_entry = archive.by_name("manifest.json").expect("manifest entry");
        std::io::Read::read_to_string(&mut manifest_entry, &mut manifest_raw)
            .expect("read manifest");
    }
    let manifest: Value = serde_json::from_str(&manifest_raw).expect("parse manifest");
    assert_eq!(manifest["format"], "evir-diagnostics/1");
    assert_eq!(manifest["appVersion"], "0.1.0");
    assert_eq!(manifest["entries"].as_array().map(Vec::len), Some(5));

    let _ = fs::remove_dir_all(&logs_dir);
    let _ = fs::remove_dir_all(&out_dir);
}

#[test]
fn rejects_unsafe_metadata_names() {
    let logs_dir = temp_dir("zip-invalid");
    write_logs(&logs_dir);
    let out_dir = temp_dir("zip-invalid-out");
    let zip_path = out_dir.join("bundle.zip");

    let metadata = vec![MetadataFile {
        name: "../evil.json".to_string(),
        contents: "{}".to_string(),
    }];
    let error = super::diagnostics::export_zip_to_path(
        &logs_dir, &zip_path, &metadata, None, false, "0.1.0",
    )
    .expect_err("unsafe names must be rejected");
    assert!(error.contains("invalid metadata file name"));

    let _ = fs::remove_dir_all(&logs_dir);
    let _ = fs::remove_dir_all(&out_dir);
}
