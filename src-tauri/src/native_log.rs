//! Native-side structured JSONL logger (browser-panel hang diagnostics).
//!
//! The frontend writes app/audit/performance JSONL under
//! `<app-data>/logs/`; the Rust side had no structured logging at all, which
//! made the 2026-09-04 main-thread hang (browser panel deadlock) invisible
//! until a stackshot was captured by hand. This module appends
//! `native-YYYY-MM-DD.jsonl` lines next to the frontend logs so future
//! hangs/crashes can be read from 设置 → 诊断 without attaching a debugger.
//!
//! Contract: every started/entered event is paired with a `done`/`ok`/`err`
//! event — a hang shows up as the last unmatched `started` line.

use std::fs::OpenOptions;
use std::io::Write;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use serde_json::json;

/// Hard cap per day-file; diagnostics only — truncate rather than rotate.
const MAX_FILE_BYTES: u64 = 8 * 1024 * 1024;

struct NativeLogState {
    dir: Option<PathBuf>,
}

static LOG_STATE: Mutex<Option<NativeLogState>> = Mutex::new(None);

/// Resolve and remember `<app-data>/logs/`. Called once from setup; failures
/// disable native logging silently (it must never break the app).
pub fn init(app_data_dir: &std::path::Path) {
    let dir = app_data_dir.join("logs");
    if std::fs::create_dir_all(&dir).is_err() {
        return;
    }
    if let Ok(mut state) = LOG_STATE.lock() {
        *state = Some(NativeLogState { dir: Some(dir) });
    }
    log("native.logger-started", json!({}));
}

/// Append one event line. Cheap enough for UI-frequency events (resize
/// layouts); bounded by MAX_FILE_BYTES per day-file.
pub fn log(event: &str, fields: serde_json::Value) {
    let dir = {
        let Ok(state) = LOG_STATE.lock() else {
            return;
        };
        match state.as_ref().and_then(|s| s.dir.clone()) {
            Some(dir) => dir,
            None => return,
        }
    };
    let (date, iso) = now_iso();
    let path = dir.join(format!("native-{date}.jsonl"));
    // Bounded: a runaway loop must not fill the disk.
    if let Ok(meta) = std::fs::metadata(&path) {
        if meta.len() > MAX_FILE_BYTES {
            let _ = std::fs::write(&path, b"");
        }
    }
    let line = json!({
        "time": iso,
        "pid": std::process::id(),
        "event": event,
        "fields": fields,
    });
    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(&path) {
        let _ = writeln!(file, "{line}");
    }
}

/// (YYYY-MM-DD, RFC3339-ish UTC timestamp) without external crates.
fn now_iso() -> (String, String) {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    let secs = now.as_secs();
    let days = secs / 86_400;
    let rem = secs % 86_400;
    let (year, month, day) = civil_from_days(days as i64);
    (
        format!("{year:04}-{month:02}-{day:02}"),
        format!(
            "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}.{:.3}Z",
            rem / 3600,
            (rem % 3600) / 60,
            rem % 60,
            now.subsec_millis(),
        ),
    )
}

/// Howard Hinnant's days→civil algorithm (proleptic Gregorian).
fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    (if m <= 2 { y + 1 } else { y }, m as u32, d as u32)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn civil_dates_match_known_values() {
        assert_eq!(civil_from_days(0), (1970, 1, 1));
        assert_eq!(civil_from_days(19_723), (2024, 1, 1)); // 2024-01-01
        assert_eq!(civil_from_days(20_651), (2026, 7, 17)); // 2026-07-17
        assert_eq!(civil_from_days(20_666), (2026, 8, 1)); // 2026-08-01
    }

    #[test]
    fn log_writes_jsonl_when_initialized() {
        let dir = std::env::temp_dir().join(format!("evir-native-log-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        init(&dir);
        log("test.event", serde_json::json!({"ok": true}));
        let state = LOG_STATE.lock().unwrap();
        let logs_dir = state.as_ref().unwrap().dir.clone().unwrap();
        drop(state);
        let file = std::fs::read_dir(&logs_dir)
            .unwrap()
            .filter_map(|e| e.ok())
            .find(|e| e.file_name().to_string_lossy().starts_with("native-"))
            .expect("log file created");
        let content = std::fs::read_to_string(file.path()).unwrap();
        let last = content
            .trim()
            .lines()
            .last()
            .expect("at least one log line");
        let parsed: serde_json::Value = serde_json::from_str(last).unwrap();
        assert_eq!(parsed["event"], "test.event");
        assert_eq!(parsed["fields"]["ok"], true);
        assert!(parsed["time"].as_str().unwrap().ends_with('Z'));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
