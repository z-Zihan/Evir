//! Desktop computer-use (CUA) primitives for the agent: screen capture and
//! synthetic mouse/keyboard input.
//!
//! v1 is macOS-only and deliberately built on system tools — `screencapture`
//! for capture, `osascript` (System Events) for input — so this adds no new
//! native dependency and nothing runs without the OS grants. Windows and
//! Linux answer with an explicit "not supported on this platform yet" error
//! instead of pretending to act.
//!
//! Reachability: every command here is only reachable through the opt-in
//! `computer_*` tools (component `evir.tools.computer-use`, disabled by
//! default, requires the `computerUse` capability). The OS still enforces
//! Screen Recording (capture) and Accessibility (synthetic input); a missing
//! grant surfaces as an honest error rather than a fake success.
//!
//! Typed text is passed to `osascript` as a positional argument, never
//! interpolated into the AppleScript source, so keystroke content cannot
//! inject script code.

#[cfg(target_os = "macos")]
use tauri::Manager;

#[cfg(target_os = "macos")]
use crate::browser_commands::{chrono_millis, png_dimensions, tool_result};

#[cfg(target_os = "macos")]
use serde_json::json;

#[cfg(not(target_os = "macos"))]
fn unsupported() -> Result<serde_json::Value, String> {
    Err("computer use is not supported on this platform yet".into())
}

#[cfg(target_os = "macos")]
fn screenshot_dir(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("computer-screenshots");
    std::fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    Ok(dir)
}

#[cfg(target_os = "macos")]
fn run_osascript(args: &[&str]) -> Result<String, String> {
    let output = std::process::Command::new("/usr/bin/osascript")
        .args(args)
        .output()
        .map_err(|error| format!("failed to start osascript: {error}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(format!(
            "osascript failed (exit {:?}); Accessibility permission is required for synthetic input: {stderr}",
            output.status.code()
        ));
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

/// macOS virtual key codes for the keys an agent realistically needs.
#[cfg(target_os = "macos")]
const KEY_CODES: &[(&str, u16)] = &[
    ("return", 36),
    ("enter", 36),
    ("tab", 48),
    ("escape", 53),
    ("delete", 51),
    ("forwarddelete", 117),
    ("space", 49),
    ("up", 126),
    ("down", 125),
    ("left", 123),
    ("right", 124),
    ("home", 115),
    ("end", 119),
    ("pageup", 116),
    ("pagedown", 121),
    ("f1", 122),
    ("f2", 120),
    ("f3", 99),
    ("f4", 118),
    ("f5", 96),
    ("f6", 97),
    ("f7", 98),
    ("f8", 100),
    ("f9", 101),
    ("f10", 109),
    ("f11", 103),
    ("f12", 111),
];

#[cfg(target_os = "macos")]
fn normalize_key_name(name: &str) -> String {
    name.trim().to_lowercase().replace(['-', '_'], "")
}

#[cfg(target_os = "macos")]
fn key_code_for(name: &str) -> Option<u16> {
    let normalized = normalize_key_name(name);
    KEY_CODES
        .iter()
        .find(|(candidate, _)| *candidate == normalized)
        .map(|(_, code)| *code)
}

#[cfg(target_os = "macos")]
fn normalize_modifier(name: &str) -> Result<&'static str, String> {
    match name.trim().to_lowercase().as_str() {
        "command" | "cmd" => Ok("command"),
        "option" | "alt" => Ok("option"),
        "control" | "ctrl" => Ok("control"),
        "shift" => Ok("shift"),
        other => Err(format!("unsupported modifier: {other}")),
    }
}

#[tauri::command]
pub async fn computer_screenshot(
    app: tauri::AppHandle,
) -> Result<serde_json::Value, String> {
    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
        unsupported()
    }
    #[cfg(target_os = "macos")]
    {
        let dir = screenshot_dir(&app)?;
        let path = dir.join(format!("{}.png", chrono_millis()));
        let status = std::process::Command::new("/usr/sbin/screencapture")
            .args(["-x", "-t", "png"])
            .arg(&path)
            .status()
            .map_err(|error| format!("failed to start screencapture: {error}"))?;
        if !status.success() {
            return Err(format!(
                "screencapture failed (exit {:?}); Screen Recording permission is required",
                status.code()
            ));
        }
        let bytes = std::fs::read(&path).map_err(|error| error.to_string())?;
        let (width, height) = png_dimensions(&bytes)?;
        tool_result(json!({
            "path": path.display().to_string(),
            "width": width,
            "height": height,
            "bytes": bytes.len(),
        }))
    }
}

#[tauri::command]
pub async fn computer_click(x: i64, y: i64) -> Result<serde_json::Value, String> {
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (x, y);
        unsupported()
    }
    #[cfg(target_os = "macos")]
    {
        let script = format!("tell application \"System Events\" to click at {{{x}, {y}}}");
        run_osascript(&["-e", &script])?;
        tool_result(json!({ "action": "click", "x": x, "y": y }))
    }
}

#[tauri::command]
pub async fn computer_type(text: String) -> Result<serde_json::Value, String> {
    #[cfg(not(target_os = "macos"))]
    {
        let _ = text;
        unsupported()
    }
    #[cfg(target_os = "macos")]
    {
        // argv form: the text is a positional argument, never part of the
        // AppleScript source, so typed content cannot inject script code.
        run_osascript(&[
            "-e",
            "on run argv",
            "-e",
            "tell application \"System Events\" to keystroke (item 1 of argv)",
            "-e",
            "end run",
            &text,
        ])?;
        tool_result(json!({ "action": "type", "chars": text.chars().count() }))
    }
}

#[tauri::command]
pub async fn computer_key(
    key: String,
    modifiers: Option<Vec<String>>,
) -> Result<serde_json::Value, String> {
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (key, modifiers);
        unsupported()
    }
    #[cfg(target_os = "macos")]
    {
        let code = key_code_for(&key).ok_or_else(|| format!("unsupported key: {key}"))?;
        let mods = modifiers.unwrap_or_default();
        let mut names = Vec::with_capacity(mods.len());
        for modifier in &mods {
            names.push(format!("{} down", normalize_modifier(modifier)?));
        }
        let using = if names.is_empty() {
            String::new()
        } else {
            format!(" using {{{}}}", names.join(", "))
        };
        run_osascript(&["-e", &format!(
            "tell application \"System Events\" to key code {code}{using}"
        )])?;
        tool_result(json!({
            "action": "key",
            "key": normalize_key_name(&key),
            "modifiers": names,
        }))
    }
}

#[tauri::command]
pub async fn computer_frontmost_app() -> Result<serde_json::Value, String> {
    #[cfg(not(target_os = "macos"))]
    {
        unsupported()
    }
    #[cfg(target_os = "macos")]
    {
        let name = run_osascript(&[
            "-e",
            "tell application \"System Events\" to get name of first application process whose frontmost is true",
        ])?;
        tool_result(json!({ "app": name }))
    }
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::*;

    #[test]
    fn maps_supported_key_names_case_and_separator_insensitively() {
        assert_eq!(key_code_for("Return"), Some(36));
        assert_eq!(key_code_for(" page-up "), Some(116));
        assert_eq!(key_code_for("ESCAPE"), Some(53));
        assert_eq!(key_code_for("forward_delete"), Some(117));
    }

    #[test]
    fn rejects_unknown_keys_and_modifiers() {
        assert_eq!(key_code_for("hyper"), None);
        assert!(normalize_modifier("command").is_ok());
        assert!(normalize_modifier("Alt").is_ok());
        assert!(normalize_modifier("hyper").is_err());
    }
}
