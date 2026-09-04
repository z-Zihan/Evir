//! Ego Lite experimental browser provider.
//!
//! ego lite (https://lite.ego.app, github.com/citrolabs/ego-lite) is a separate
//! macOS Chromium browser whose only documented programmatic surface is the
//! `ego-browser nodejs` CLI: a script is fed on stdin, preloaded helpers drive
//! isolated task spaces that inherit the user's ego login state, and results
//! are printed by the script itself. There is no HTTP API or SDK, so this
//! adapter speaks the CLI contract:
//!
//! - every operation is one short-lived `ego-browser nodejs` subprocess;
//! - scripts select the caller-provided task space (Evir passes
//!   `evir-<profileId>` so sessions stay profile-scoped);
//! - the script reports its result with a single `__EVIR__<json>` cliLog line
//!   which we parse off stdout; failures surface as non-zero exits whose
//!   stderr tail becomes the error message.
//!
//! Evir never installs or launches ego lite silently: the user installs the
//! app and completes its onboarding themselves, and this module only probes
//! for the CLI they registered.

use std::path::PathBuf;
use std::time::Duration;

use serde_json::{json, Value};

/// Marker prefix scripts use for the machine-readable result line.
const RESULT_MARKER: &str = "__EVIR__";
const DEFAULT_TIMEOUT: Duration = Duration::from_secs(45);
const NAVIGATE_TIMEOUT: Duration = Duration::from_secs(90);
const PROBE_TIMEOUT: Duration = Duration::from_secs(25);
/// Screenshot base64 accepted on stdout before it is decoded and written.
const MAX_SCREENSHOT_BASE64: usize = 24 * 1024 * 1024;

/// Locate the `ego-browser` CLI the ego lite app registers during onboarding
/// (`~/.local/bin`), falling back to a PATH scan.
pub fn find_ego_cli() -> Option<PathBuf> {
    let home = std::env::var_os("HOME").map(PathBuf::from)?;
    let helper = home.join(".local").join("bin").join("ego-browser");
    if helper.is_file() {
        return Some(helper);
    }
    let path = std::env::var_os("PATH")?;
    std::env::split_paths(&path)
        .map(|dir| dir.join("ego-browser"))
        .find(|candidate| candidate.is_file())
}

/// Extract the JSON value from the last `__EVIR__`-prefixed stdout line.
fn parse_result_line(stdout: &str) -> Result<Value, String> {
    let line = stdout
        .lines()
        .rev()
        .find(|line| line.starts_with(RESULT_MARKER))
        .ok_or_else(|| {
            format!(
                "ego-browser produced no result marker{}",
                text_tail(stdout, 200)
            )
        })?;
    let payload = line.trim_start_matches(RESULT_MARKER);
    serde_json::from_str(payload).map_err(|error| format!("ego-browser result malformed: {error}"))
}

fn text_tail(text: &str, limit: usize) -> String {
    let suffix: String = text.trim().chars().rev().take(limit).collect();
    suffix.chars().rev().collect()
}

/// Sanitize a task-space name: alphanumeric / dash / underscore, bounded.
fn sanitize_space(raw: &str) -> String {
    let cleaned: String = raw
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '-'
            }
        })
        .collect();
    let trimmed = cleaned.trim_matches('-');
    let bounded: String = trimmed.chars().take(48).collect();
    if bounded.is_empty() {
        "evir".to_string()
    } else {
        bounded
    }
}

fn json_literal(value: &str) -> String {
    serde_json::to_string(value).unwrap_or_else(|_| "\"\"".to_string())
}

/// Wrap an operation body in the standard preamble (space selection) and the
/// result marker output.
fn wrap_script(space: &str, body: &str) -> String {
    format!(
        "const space = {space};\nawait useOrCreateTaskSpace(space);\n{body}\ncliLog({marker} + JSON.stringify(result));\n",
        space = json_literal(&sanitize_space(space)),
        body = body,
        marker = json_literal(RESULT_MARKER),
    )
}

/// Build the Node script for one operation. `params` values are embedded as
/// JSON string literals so URLs/text/refs cannot break out of the script.
fn build_script(op: &str, params: &Value, space: &str) -> Result<String, String> {
    let str_param = |name: &str| -> Result<String, String> {
        params
            .get(name)
            .and_then(Value::as_str)
            .map(str::to_string)
            .ok_or_else(|| format!("missing param: {name}"))
    };
    let body = match op {
        "open" | "navigate" => format!(
            "await openOrReuseTab({url}, {{ wait: true, timeout: 60 }});\n\
             const info = await pageInfo();\n\
             if (info && info.dialog) {{ throw new Error('native browser dialog open in ego lite: ' + JSON.stringify(info.dialog)); }}\n\
             const result = {{ url: info.url, title: info.title }};",
            url = json_literal(&str_param("url")?)
        ),
        "history" => {
            let direction = str_param("direction")?;
            let action = match direction.as_str() {
                "back" => "history.back()".to_string(),
                "forward" => "history.forward()".to_string(),
                "reload" => "location.reload()".to_string(),
                other => return Err(format!("unsupported history direction: {other}")),
            };
            format!(
                "await js({action});\nawait wait(1);\n\
                 const info = await pageInfo();\n\
                 const result = {{ url: info && info.url ? info.url : '', title: info && info.title ? info.title : '' }};",
                action = json_literal(&action)
            )
        }
        "snapshot" => "const snapshot = await snapshotText();\nconst result = { snapshot };".to_string(),
        "get_text" => format!(
            "const text = await js({expr});\nconst result = {{ text: String(text ?? '').slice(0, 12000) }};",
            expr = json_literal("document.body ? document.body.innerText : ''")
        ),
        "url" => "\
            const info = await pageInfo();\n\
            if (info && info.dialog) { throw new Error('native browser dialog open in ego lite: ' + JSON.stringify(info.dialog)); }\n\
            const result = { url: info.url, title: info.title };"
            .to_string(),
        "click" => format!(
            "const ref = {ref};\nawait click(ref);\nconst result = {{ clicked: ref }};",
            ref = json_literal(&str_param("ref")?)
        ),
        "fill" => format!(
            "const ref = {ref}; const text = {text};\nawait fillInput(ref, text);\nconst result = {{ filled: ref, characters: [...text].length }};",
            ref = json_literal(&str_param("ref")?),
            text = json_literal(&str_param("text")?)
        ),
        "press" => format!(
            "const key = {key};\nawait pressKey(key);\nconst result = {{ pressed: key }};",
            key = json_literal(&str_param("key")?)
        ),
        "scroll" => {
            let direction = str_param("direction")?;
            let amount = params
                .get("amount")
                .and_then(Value::as_f64)
                .unwrap_or(600.0)
                .clamp(50.0, 5000.0) as i64;
            let signed = if direction == "up" { -amount } else { amount };
            if direction != "up" && direction != "down" {
                return Err(format!("unsupported scroll direction: {direction}"));
            }
            format!(
                "await scrollBy({signed});\nconst result = {{ scrolled: {dir}, pixels: {amount} }};",
                signed = signed,
                dir = json_literal(&direction),
                amount = amount
            )
        }
        "tabs" => "const tabs = await listTabs();\nconst result = { tabs };".to_string(),
        "switch_tab" => format!(
            "const target = {target};\nawait switchTab(target);\nconst result = {{ active: target }};",
            target = json_literal(&str_param("target_id")?)
        ),
        "close_tab" => format!(
            "const target = {target};\nawait closeTab(target);\nconst result = {{ closed: target }};",
            target = json_literal(&str_param("target_id")?)
        ),
        "wait" => {
            let ms = params.get("ms").and_then(Value::as_u64).unwrap_or(500).min(10_000);
            format!(
                "await wait({seconds});\nconst result = {{ waitedMs: {ms} }};",
                seconds = ms as f64 / 1000.0,
                ms = ms
            )
        }
        "screenshot" => "\
            const shot = await captureScreenshot();\n\
            const raw = typeof shot === 'string' ? shot : ((shot && (shot.base64 || shot.data)) ?? '');\n\
            const result = { screenshotBase64: String(raw) };"
            .to_string(),
        "stop" => "\
            let stopped = true;\n\
            try { await completeTaskSpace(space, { keep: false }); } catch (e) { stopped = false; }\n\
            const result = { stopped };"
            .to_string(),
        other => return Err(format!("unsupported ego operation: {other}")),
    };
    Ok(wrap_script(space, &body))
}

fn timeout_for(op: &str) -> Duration {
    match op {
        "open" | "navigate" => NAVIGATE_TIMEOUT,
        "stop" => Duration::from_secs(30),
        _ => DEFAULT_TIMEOUT,
    }
}

/// Run one `ego-browser nodejs` script and parse its result marker.
async fn run_ego_script(script: String, timeout: Duration) -> Result<Value, String> {
    let cli = find_ego_cli().ok_or_else(|| {
        "ego-browser CLI not found — install ego lite and finish its onboarding, then retry"
            .to_string()
    })?;
    let mut command = tokio::process::Command::new(&cli);
    command
        .arg("nodejs")
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .kill_on_drop(true);
    let mut child = command
        .spawn()
        .map_err(|error| format!("failed to launch ego-browser CLI: {error}"))?;
    use tokio::io::AsyncWriteExt;
    if let Some(stdin) = child.stdin.as_mut() {
        stdin
            .write_all(script.as_bytes())
            .await
            .map_err(|error| format!("failed to write ego-browser script: {error}"))?;
        stdin
            .write_all(b"\n")
            .await
            .map_err(|error| format!("failed to write ego-browser script: {error}"))?;
        stdin
            .shutdown()
            .await
            .map_err(|error| format!("failed to close ego-browser stdin: {error}"))?;
    }
    let output = tokio::time::timeout(timeout, child.wait_with_output())
        .await
        .map_err(|_| {
            format!(
                "ego-browser operation timed out after {}s",
                timeout.as_secs()
            )
        })?
        .map_err(|error| format!("ego-browser CLI failed: {error}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!(
            "ego-browser error: {}",
            if stderr.trim().is_empty() {
                format!("exit status {}", output.status)
            } else {
                text_tail(&stderr, 500)
            }
        ));
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    parse_result_line(&stdout)
}

fn png_dimensions(bytes: &[u8]) -> Result<(u32, u32), String> {
    if bytes.len() < 24 || &bytes[..8] != b"\x89PNG\r\n\x1a\n" {
        return Err("ego screenshot is not a PNG".into());
    }
    let width = u32::from_be_bytes([bytes[16], bytes[17], bytes[18], bytes[19]]);
    let height = u32::from_be_bytes([bytes[20], bytes[21], bytes[22], bytes[23]]);
    Ok((width, height))
}

fn chrono_millis() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0)
}

/// Persist an ego screenshot next to the CDP runtime's screenshots so the
/// existing preview/read-back path keeps working.
fn persist_screenshot(app: &tauri::AppHandle, result: Value) -> Result<Value, String> {
    use base64::Engine as _;
    use tauri::Manager;
    let base64_data = result
        .get("screenshotBase64")
        .and_then(Value::as_str)
        .filter(|raw| !raw.is_empty())
        .ok_or_else(|| "ego screenshot returned no image data".to_string())?;
    if base64_data.len() > MAX_SCREENSHOT_BASE64 {
        return Err("ego screenshot too large".into());
    }
    let stripped = base64_data
        .strip_prefix("data:image/png;base64,")
        .unwrap_or(base64_data);
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(stripped)
        .map_err(|error| format!("ego screenshot is not valid base64: {error}"))?;
    let (width, height) = png_dimensions(&bytes)?;
    let dir = app
        .path()
        .app_data_dir()
        .ok()
        .map(|base| base.join("browser-screenshots"))
        .unwrap_or_else(std::env::temp_dir);
    std::fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    let path = dir.join(format!("{}.png", chrono_millis()));
    std::fs::write(&path, &bytes).map_err(|error| error.to_string())?;
    Ok(json!({
        "path": path.display().to_string(),
        "width": width,
        "height": height,
        "bytes": bytes.len()
    }))
}

/// Detect the ego-browser CLI; optionally probe a real subprocess round-trip
/// (costs a Node spawn, ~1-2s) to confirm the ego lite app is connected.
#[tauri::command]
pub async fn ego_browser_status(probe: Option<bool>) -> Result<serde_json::Value, String> {
    let cli = find_ego_cli();
    let mut payload = json!({
        "available": cli.is_some(),
        "cliPath": cli.as_ref().map(|path| path.display().to_string()).unwrap_or_default(),
        "appConnected": Value::Null,
    });
    if probe.unwrap_or(false) {
        if cli.is_none() {
            payload["appConnected"] = json!(false);
        } else {
            let script = format!(
                "cliLog({marker} + JSON.stringify({{ ok: true }}));\n",
                marker = json_literal(RESULT_MARKER)
            );
            payload["appConnected"] = match run_ego_script(script, PROBE_TIMEOUT).await {
                Ok(_) => json!(true),
                Err(message) => json!({ "ok": false, "error": message }),
            };
        }
    }
    Ok(payload)
}

/// Execute one browser operation against the profile-scoped ego task space.
#[tauri::command]
pub async fn ego_browser_run(
    app: tauri::AppHandle,
    op: String,
    params: serde_json::Value,
    space: String,
) -> Result<serde_json::Value, String> {
    if sanitize_space(&space) != space.trim() || space.trim().is_empty() {
        return Err("invalid ego task space name".into());
    }
    let script = build_script(&op, &params, &space)?;
    let result = run_ego_script(script, timeout_for(&op)).await?;
    if op == "screenshot" {
        return persist_screenshot(&app, result);
    }
    Ok(result)
}

/// Close the profile's ego task space (best effort; closing all tabs closes
/// the space).
#[tauri::command]
pub async fn ego_browser_stop(space: String) -> Result<serde_json::Value, String> {
    let script = build_script("stop", &json!({}), &space)?;
    run_ego_script(script, Duration::from_secs(30)).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitizes_space_names() {
        assert_eq!(sanitize_space("evir-default"), "evir-default");
        assert_eq!(sanitize_space("evir/../etc"), "evir----etc");
        assert_eq!(sanitize_space("  "), "evir");
        let long = "a".repeat(80);
        assert_eq!(sanitize_space(&long).len(), 48);
    }

    #[test]
    fn builds_navigation_script_with_embedded_json() {
        let params = json!({ "url": "https://example.com/?q=\"}; process.exit(1); //" });
        let script = build_script("open", &params, "evir-default").unwrap();
        assert!(script.contains("const space = \"evir-default\""));
        assert!(script.contains("await useOrCreateTaskSpace(space)"));
        // The URL is embedded as a JSON literal, so quotes cannot break the script.
        assert!(
            script.contains("openOrReuseTab(\"https://example.com/?q=\\\"}; process.exit(1); //\"")
        );
        assert!(script.contains("cliLog(\"__EVIR__\" + JSON.stringify(result))"));
    }

    #[test]
    fn builds_click_and_fill_scripts() {
        let click = build_script("click", &json!({ "ref": "@21" }), "evir-x").unwrap();
        assert!(click.contains("const ref = \"@21\""));
        assert!(click.contains("await click(ref)"));
        let fill = build_script(
            "fill",
            &json!({ "ref": "loc=role:button", "text": "hello \"world\"\nnewline" }),
            "evir-x",
        )
        .unwrap();
        assert!(fill.contains("const ref = \"loc=role:button\""));
        assert!(fill.contains("const text = \"hello \\\"world\\\"\\nnewline\""));
        assert!(fill.contains("await fillInput(ref, text)"));
    }

    #[test]
    fn rejects_unknown_ops_and_bad_directions() {
        assert!(build_script("rm_rf", &json!({}), "evir").is_err());
        assert!(build_script("history", &json!({ "direction": "sideways" }), "evir").is_err());
        assert!(build_script("open", &json!({}), "evir").is_err());
    }

    #[test]
    fn parses_result_marker_line() {
        let stdout =
            "noise\nmore noise\n__EVIR__{\"url\":\"https://a.example\",\"title\":\"A\"}\ntrailing";
        let parsed = parse_result_line(stdout).unwrap();
        assert_eq!(parsed["url"], "https://a.example");
        assert!(parse_result_line("no marker here").is_err());
    }

    #[test]
    fn stop_script_tolerates_missing_space() {
        let script = build_script("stop", &json!({}), "evir-default").unwrap();
        assert!(script.contains("completeTaskSpace(space, { keep: false })"));
        assert!(script.contains("catch"));
    }
}
