//! Browser agent tool commands (CDP-backed): navigation, snapshot, actions,
//! screenshots and tab management. Each command is bounded by timeouts and
//! returns model-friendly structured output.

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Duration;

use base64::Engine as _;
use serde_json::json;

use crate::ax_snapshot::{build_snapshot, truncate_page_text, SnapshotBuild};
use crate::browser_runtime::{detect_browser, BrowserAgentRuntime, BrowserRuntimeStatus};
use crate::cdp::{CdpClient, CdpEventKind};

const COMMAND_TIMEOUT: Duration = Duration::from_secs(15);
const NAVIGATE_TIMEOUT: Duration = Duration::from_secs(30);
const PAGE_TEXT_LIMIT: usize = 12_000;

pub struct BrowserAgentState {
    runtime: tokio::sync::Mutex<Option<BrowserAgentRuntime>>,
    sessions: Mutex<HashMap<String, String>>,
    refs: Mutex<HashMap<String, (String, i64)>>,
    active_target: Mutex<Option<String>>,
    screenshot_dir: Mutex<Option<std::path::PathBuf>>,
}

impl Default for BrowserAgentState {
    fn default() -> Self {
        Self {
            runtime: tokio::sync::Mutex::new(None),
            sessions: Mutex::new(HashMap::new()),
            refs: Mutex::new(HashMap::new()),
            active_target: Mutex::new(None),
            screenshot_dir: Mutex::new(None),
        }
    }
}

impl BrowserAgentState {
    fn set_screenshot_dir(&self, app: &tauri::AppHandle) {
        use tauri::Manager;
        let mut dir = self.screenshot_dir.lock().expect("screenshot dir lock");
        if dir.is_none() {
            *dir = app
                .path()
                .app_data_dir()
                .ok()
                .map(|base| base.join("browser-screenshots"));
        }
    }
}

fn tool_result(payload: serde_json::Value) -> Result<serde_json::Value, String> {
    Ok(payload)
}

async fn require_client(state: &BrowserAgentState) -> Result<(CdpClient, String), String> {
    let mut guard = state.runtime.lock().await;
    if guard.is_none() {
        let runtime = BrowserAgentRuntime::launch().await?;
        *guard = Some(runtime);
    }
    let runtime = guard.as_ref().expect("runtime present");
    let target = runtime
        .client
        .send("Target.getTargets", json!({}), None, COMMAND_TIMEOUT)
        .await?;
    let pages: Vec<String> = target
        .get("targetInfos")
        .and_then(|infos| infos.as_array())
        .map(|infos| {
            infos
                .iter()
                .filter(|info| info.get("type").and_then(|t| t.as_str()) == Some("page"))
                .filter_map(|info| {
                    info.get("targetId")
                        .and_then(|id| id.as_str())
                        .map(str::to_string)
                })
                .collect()
        })
        .unwrap_or_default();
    let target_id = match pages.first() {
        Some(first) if !pages.is_empty() => first.clone(),
        _ => {
            let created = runtime
                .client
                .send(
                    "Target.createTarget",
                    json!({ "url": "about:blank" }),
                    None,
                    COMMAND_TIMEOUT,
                )
                .await?;
            created
                .get("targetId")
                .and_then(|id| id.as_str())
                .unwrap_or_default()
                .to_string()
        }
    };
    *state.active_target.lock().expect("active target lock") = Some(target_id.clone());
    session_for(state, &runtime.client, &target_id).await?;
    Ok((runtime.client.clone(), target_id))
}

async fn session_for(
    state: &BrowserAgentState,
    client: &CdpClient,
    target_id: &str,
) -> Result<String, String> {
    if let Some(session) = state.sessions.lock().expect("session lock").get(target_id) {
        return Ok(session.clone());
    }
    let attached = client
        .send(
            "Target.attachToTarget",
            json!({ "targetId": target_id, "flatten": true }),
            None,
            COMMAND_TIMEOUT,
        )
        .await?;
    let session = attached
        .get("sessionId")
        .and_then(|id| id.as_str())
        .ok_or("cdp attach missing session")?
        .to_string();
    for method in ["Page.enable", "Runtime.enable", "DOM.enable"] {
        client
            .send(method, json!({}), Some(&session), COMMAND_TIMEOUT)
            .await?;
    }
    state
        .sessions
        .lock()
        .expect("session lock")
        .insert(target_id.to_string(), session.clone());
    Ok(session)
}

async fn active_session(state: &BrowserAgentState) -> Result<(CdpClient, String, String), String> {
    let (client, target_id) = require_client(state).await?;
    let session = session_for(state, &client, &target_id).await?;
    Ok((client, target_id, session))
}

async fn navigate_and_wait(
    state: &BrowserAgentState,
    url: &str,
    new_tab: bool,
) -> Result<serde_json::Value, String> {
    let (client, target_id) = require_client(state).await?;
    let target = if new_tab {
        let created = client
            .send(
                "Target.createTarget",
                json!({ "url": url }),
                None,
                COMMAND_TIMEOUT,
            )
            .await?;
        let id = created
            .get("targetId")
            .and_then(|value| value.as_str())
            .ok_or("createTarget missing id")?
            .to_string();
        *state.active_target.lock().expect("active target lock") = Some(id.clone());
        let _ = client
            .send(
                "Target.activateTarget",
                json!({ "targetId": id }),
                None,
                COMMAND_TIMEOUT,
            )
            .await;
        id
    } else {
        let session = session_for(state, &client, &target_id).await?;
        let load = client.wait_for(CdpEventKind::LoadFired(session.clone()), NAVIGATE_TIMEOUT);
        client
            .send(
                "Page.navigate",
                json!({ "url": url }),
                Some(&session),
                COMMAND_TIMEOUT,
            )
            .await?;
        let _ = load.await;
        target_id
    };
    let session = session_for(state, &client, &target).await?;
    // Small settle delay for SPA hydration after load event.
    tokio::time::sleep(Duration::from_millis(250)).await;
    let title = client
        .send(
            "Runtime.evaluate",
            json!({ "expression": "document.title", "returnByValue": true }),
            Some(&session),
            COMMAND_TIMEOUT,
        )
        .await?
        .get("result")
        .and_then(|result| result.get("value"))
        .and_then(|value| value.as_str())
        .unwrap_or("")
        .to_string();
    tool_result(json!({ "targetId": target, "url": url, "title": title }))
}

#[tauri::command]
pub async fn browser_agent_status(
    state: tauri::State<'_, BrowserAgentState>,
) -> Result<serde_json::Value, String> {
    let detected = detect_browser();
    let guard = state.runtime.lock().await;
    if let Some(runtime) = guard.as_ref() {
        if !runtime.client.is_closed() {
            return Ok(json!(runtime.status()));
        }
    }
    Ok(json!(BrowserRuntimeStatus {
        available: detected.is_some(),
        engine: detected
            .as_ref()
            .map(|(engine, _)| engine.clone())
            .unwrap_or_default(),
        path: detected
            .map(|(_, path)| path.display().to_string())
            .unwrap_or_default(),
        running: false,
        version: None,
    }))
}

#[tauri::command]
pub async fn browser_agent_start(
    state: tauri::State<'_, BrowserAgentState>,
) -> Result<serde_json::Value, String> {
    let mut guard = state.runtime.lock().await;
    if let Some(runtime) = guard.as_ref() {
        if !runtime.client.is_closed() {
            return Ok(json!({ "started": true, "engine": runtime.engine_name() }));
        }
    }
    let runtime = BrowserAgentRuntime::launch().await?;
    let engine = runtime.engine_name().to_string();
    *guard = Some(runtime);
    Ok(json!({ "started": true, "engine": engine }))
}

#[tauri::command]
pub async fn browser_agent_stop(state: tauri::State<'_, BrowserAgentState>) -> Result<(), String> {
    let mut guard = state.runtime.lock().await;
    if let Some(mut runtime) = guard.take() {
        runtime.shutdown().await;
    }
    state.sessions.lock().expect("session lock").clear();
    state.refs.lock().expect("refs lock").clear();
    *state.active_target.lock().expect("active target lock") = None;
    Ok(())
}

#[tauri::command]
pub async fn browser_open(
    state: tauri::State<'_, BrowserAgentState>,
    url: String,
) -> Result<serde_json::Value, String> {
    navigate_and_wait(&state, &url, true).await
}

#[tauri::command]
pub async fn browser_navigate(
    state: tauri::State<'_, BrowserAgentState>,
    url: String,
) -> Result<serde_json::Value, String> {
    navigate_and_wait(&state, &url, false).await
}

#[tauri::command]
pub async fn browser_history(
    state: tauri::State<'_, BrowserAgentState>,
    direction: String,
) -> Result<serde_json::Value, String> {
    let (client, _target, session) = active_session(&state).await?;
    match direction.as_str() {
        "back" | "forward" => {
            client
                .send(
                    "Runtime.evaluate",
                    json!({ "expression": format!("history.{}()", direction), "awaitPromise": false }),
                    Some(&session),
                    COMMAND_TIMEOUT,
                )
                .await?;
        }
        "reload" => {
            client
                .send("Page.reload", json!({}), Some(&session), COMMAND_TIMEOUT)
                .await?;
        }
        _ => return Err("direction must be back, forward or reload".into()),
    }
    tokio::time::sleep(Duration::from_millis(400)).await;
    browser_url(state).await
}

#[tauri::command]
pub async fn browser_snapshot(
    state: tauri::State<'_, BrowserAgentState>,
) -> Result<serde_json::Value, String> {
    let (client, target_id, session) = active_session(&state).await?;
    let tree = client
        .send(
            "Accessibility.getFullAXTree",
            json!({}),
            Some(&session),
            COMMAND_TIMEOUT,
        )
        .await?;
    let build: SnapshotBuild = build_snapshot(&target_id, &tree);
    *state.refs.lock().expect("refs lock") = build.refs;
    Ok(json!({ "snapshot": build.lines.join("\n") }))
}

async fn node_id_for(client: &CdpClient, session: &str, backend_id: i64) -> Result<i64, String> {
    let pushed = client
        .send(
            "DOM.pushNodesByBackendIdsToFrontend",
            json!({ "backendNodeIds": [backend_id] }),
            Some(session),
            COMMAND_TIMEOUT,
        )
        .await?;
    pushed
        .get("nodeIds")
        .and_then(|ids| ids.as_array())
        .and_then(|ids| ids.first())
        .and_then(|id| id.as_i64())
        .ok_or_else(|| "ref no longer resolves (page changed?) — take a new snapshot".to_string())
}

#[tauri::command]
pub async fn browser_click(
    state: tauri::State<'_, BrowserAgentState>,
    element_ref: String,
) -> Result<serde_json::Value, String> {
    let (client, _target, session) = active_session(&state).await?;
    let backend = lookup_ref(&state, &element_ref)?;
    let node_id = node_id_for(&client, &session, backend).await?;
    let _ = client
        .send(
            "DOM.scrollIntoViewIfNeeded",
            json!({ "nodeId": node_id }),
            Some(&session),
            COMMAND_TIMEOUT,
        )
        .await;
    let box_model = client
        .send(
            "DOM.getBoxModel",
            json!({ "nodeId": node_id }),
            Some(&session),
            COMMAND_TIMEOUT,
        )
        .await?;
    let quad = box_model
        .get("model")
        .and_then(|model| model.get("content"))
        .and_then(|content| content.as_array())
        .ok_or("element has no box (hidden?)")?;
    let coords: Vec<f64> = quad.iter().filter_map(|point| point.as_f64()).collect();
    if coords.len() < 8 {
        return Err("element box malformed".into());
    }
    let x = (coords[0] + coords[4]) / 2.0;
    let y = (coords[1] + coords[5]) / 2.0;
    for event_type in ["mousePressed", "mouseReleased"] {
        client
            .send(
                "Input.dispatchMouseEvent",
                json!({ "type": event_type, "x": x, "y": y, "button": "left", "clickCount": 1 }),
                Some(&session),
                COMMAND_TIMEOUT,
            )
            .await?;
    }
    tokio::time::sleep(Duration::from_millis(350)).await;
    tool_result(json!({ "clicked": element_ref, "at": [x, y] }))
}

fn lookup_ref(state: &BrowserAgentState, element_ref: &str) -> Result<i64, String> {
    state
        .refs
        .lock()
        .expect("refs lock")
        .get(element_ref)
        .map(|(_, backend)| *backend)
        .ok_or_else(|| format!("unknown ref {element_ref} — take a new snapshot"))
}

const SET_VALUE_FN: &str = r#"function(text){
  const target = this;
  const proto = Object.getPrototypeOf(target);
  const descriptor = Object.getOwnPropertyDescriptor(proto, 'value') || Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
  if (descriptor && descriptor.set) { descriptor.set.call(target, text); }
  else { target.value = text; }
  target.dispatchEvent(new Event('input', { bubbles: true }));
  target.dispatchEvent(new Event('change', { bubbles: true }));
}"#;

const SELECT_VALUE_FN: &str = r#"function(text){
  const target = this;
  for (const option of target.options) {
    if (option.value === text || option.text.trim() === text) {
      target.value = option.value;
      target.dispatchEvent(new Event('input', { bubbles: true }));
      target.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }
  }
  return false;
}"#;

async fn call_on_ref(
    state: &BrowserAgentState,
    element_ref: &str,
    function_source: &str,
    argument: &str,
) -> Result<serde_json::Value, String> {
    let (client, _target, session) = active_session(state).await?;
    let backend = lookup_ref(state, element_ref)?;
    let node_id = node_id_for(&client, &session, backend).await?;
    let resolved = client
        .send(
            "DOM.resolveNode",
            json!({ "nodeId": node_id }),
            Some(&session),
            COMMAND_TIMEOUT,
        )
        .await?;
    let object_id = resolved
        .get("object")
        .and_then(|object| object.get("objectId"))
        .and_then(|id| id.as_str())
        .ok_or("element resolved to no remote object")?
        .to_string();
    let result = client
        .send(
            "Runtime.callFunctionOn",
            json!({
                "objectId": object_id,
                "functionDeclaration": function_source,
                "arguments": [{ "value": argument }],
                "returnByValue": true
            }),
            Some(&session),
            COMMAND_TIMEOUT,
        )
        .await?;
    Ok(result)
}

#[tauri::command]
pub async fn browser_fill(
    state: tauri::State<'_, BrowserAgentState>,
    element_ref: String,
    text: String,
) -> Result<serde_json::Value, String> {
    call_on_ref(&state, &element_ref, SET_VALUE_FN, &text).await?;
    tool_result(json!({ "filled": element_ref, "characters": text.chars().count() }))
}

#[tauri::command]
pub async fn browser_select(
    state: tauri::State<'_, BrowserAgentState>,
    element_ref: String,
    value: String,
) -> Result<serde_json::Value, String> {
    let result = call_on_ref(&state, &element_ref, SELECT_VALUE_FN, &value).await?;
    let ok = result
        .get("result")
        .and_then(|inner| inner.get("value"))
        .and_then(|value| value.as_bool())
        .unwrap_or(false);
    if !ok {
        return Err(format!("option \"{value}\" not found"));
    }
    tool_result(json!({ "selected": element_ref, "value": value }))
}

fn key_event_payloads(key: &str) -> Result<Vec<serde_json::Value>, String> {
    let (code, virtual_key, text) = match key {
        "Enter" => ("Enter", 13u32, "\r"),
        "Tab" => ("Tab", 9, "\t"),
        "Escape" => ("Escape", 27, ""),
        "Backspace" => ("Backspace", 8, ""),
        "Delete" => ("Delete", 46, ""),
        "ArrowUp" => ("ArrowUp", 38, ""),
        "ArrowDown" => ("ArrowDown", 40, ""),
        "ArrowLeft" => ("ArrowLeft", 37, ""),
        "ArrowRight" => ("ArrowRight", 39, ""),
        other => {
            let mut chars = other.chars();
            let (first, rest) = (chars.next(), chars.next());
            match (first, rest) {
                (Some(single), None) if single.is_ascii_graphic() => (other, single as u32, other),
                _ => return Err(format!("unsupported key: {other}")),
            }
        }
    };
    let mut events = vec![json!({
        "type": "rawKeyDown", "key": key, "code": code, "windowsVirtualKeyCode": virtual_key, "nativeVirtualKeyCode": virtual_key
    })];
    if !text.is_empty() {
        events.push(json!({ "type": "char", "text": text }));
    }
    events.push(json!({
        "type": "keyUp", "key": key, "code": code, "windowsVirtualKeyCode": virtual_key, "nativeVirtualKeyCode": virtual_key
    }));
    Ok(events)
}

#[tauri::command]
pub async fn browser_press(
    state: tauri::State<'_, BrowserAgentState>,
    key: String,
) -> Result<serde_json::Value, String> {
    let (client, _target, session) = active_session(&state).await?;
    for event in key_event_payloads(&key)? {
        client
            .send(
                "Input.dispatchKeyEvent",
                event,
                Some(&session),
                COMMAND_TIMEOUT,
            )
            .await?;
    }
    tokio::time::sleep(Duration::from_millis(200)).await;
    tool_result(json!({ "pressed": key }))
}

#[tauri::command]
pub async fn browser_scroll(
    state: tauri::State<'_, BrowserAgentState>,
    direction: String,
    amount: Option<f64>,
) -> Result<serde_json::Value, String> {
    let (client, _target, session) = active_session(&state).await?;
    let pixels = (amount.unwrap_or(600.0).clamp(50.0, 5000.0)) as i64;
    let script = match direction.as_str() {
        "down" => format!("window.scrollBy(0, {pixels})"),
        "up" => format!("window.scrollBy(0, -{pixels})"),
        other => return Err(format!("unsupported scroll direction: {other}")),
    };
    client
        .send(
            "Runtime.evaluate",
            json!({ "expression": script }),
            Some(&session),
            COMMAND_TIMEOUT,
        )
        .await?;
    tokio::time::sleep(Duration::from_millis(250)).await;
    tool_result(json!({ "scrolled": direction, "pixels": pixels }))
}

#[tauri::command]
pub async fn browser_get_text(
    state: tauri::State<'_, BrowserAgentState>,
) -> Result<serde_json::Value, String> {
    let (client, _target, session) = active_session(&state).await?;
    let text = client
        .send(
            "Runtime.evaluate",
            json!({ "expression": "document.body ? document.body.innerText : ''", "returnByValue": true }),
            Some(&session),
            COMMAND_TIMEOUT,
        )
        .await?
        .get("result")
        .and_then(|result| result.get("value"))
        .and_then(|value| value.as_str())
        .unwrap_or("")
        .to_string();
    tool_result(json!({ "text": truncate_page_text(&text, PAGE_TEXT_LIMIT) }))
}

#[tauri::command]
pub async fn browser_url(
    state: tauri::State<'_, BrowserAgentState>,
) -> Result<serde_json::Value, String> {
    let (client, _target, session) = active_session(&state).await?;
    let payload = client
        .send(
            "Runtime.evaluate",
            json!({ "expression": "[location.href, document.title]", "returnByValue": true }),
            Some(&session),
            COMMAND_TIMEOUT,
        )
        .await?;
    let values = payload
        .get("result")
        .and_then(|result| result.get("value"))
        .and_then(|value| value.as_array())
        .cloned()
        .unwrap_or_default();
    let url = values
        .first()
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let title = values
        .get(1)
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    tool_result(json!({ "url": url, "title": title }))
}

#[tauri::command]
pub async fn browser_screenshot(
    app: tauri::AppHandle,
    state: tauri::State<'_, BrowserAgentState>,
) -> Result<serde_json::Value, String> {
    state.inner().set_screenshot_dir(&app);
    let (client, _target, session) = active_session(&state).await?;
    let shot = client
        .send(
            "Page.captureScreenshot",
            json!({ "format": "png" }),
            Some(&session),
            COMMAND_TIMEOUT,
        )
        .await?;
    let base64_data = shot
        .get("data")
        .and_then(|data| data.as_str())
        .ok_or("screenshot returned no data")?;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(base64_data)
        .map_err(|error| error.to_string())?;
    let (width, height) = png_dimensions(&bytes)?;
    let dir = state
        .screenshot_dir
        .lock()
        .expect("screenshot dir lock")
        .clone()
        .unwrap_or_else(std::env::temp_dir);
    std::fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    let path = dir.join(format!("{}.png", chrono_millis()));
    std::fs::write(&path, &bytes).map_err(|error| error.to_string())?;
    tool_result(json!({
        "path": path.display().to_string(),
        "width": width,
        "height": height,
        "bytes": bytes.len()
    }))
}

/// Read a saved agent-browser screenshot for the workspace preview. The
/// path must live inside the managed browser-screenshots directory — never
/// an arbitrary filesystem read.
#[tauri::command(async)]
pub async fn browser_screenshot_read(
    app: tauri::AppHandle,
    state: tauri::State<'_, BrowserAgentState>,
    path: String,
) -> Result<String, String> {
    use base64::Engine as _;
    use std::io::Read as _;
    state.inner().set_screenshot_dir(&app);
    let dir = state
        .screenshot_dir
        .lock()
        .expect("screenshot dir lock")
        .clone()
        .unwrap_or_else(std::env::temp_dir);
    let canonical_dir = dir.canonicalize().unwrap_or(dir);
    let requested = std::path::PathBuf::from(&path);
    let canonical = requested
        .canonicalize()
        .map_err(|_| "screenshot not found")?;
    if !canonical.starts_with(&canonical_dir) {
        return Err("path outside screenshots directory".into());
    }
    const MAX: u64 = 16 << 20;
    let mut file = std::fs::File::open(&canonical).map_err(|error| error.to_string())?;
    let mut bytes = Vec::new();
    (&mut file)
        .take(MAX + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| error.to_string())?;
    if bytes.len() as u64 > MAX {
        return Err("screenshot too large".into());
    }
    Ok(base64::engine::general_purpose::STANDARD.encode(bytes))
}

fn chrono_millis() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0)
}

fn png_dimensions(bytes: &[u8]) -> Result<(u32, u32), String> {
    if bytes.len() < 24 || &bytes[..8] != b"\x89PNG\r\n\x1a\n" {
        return Err("screenshot is not a PNG".into());
    }
    let width = u32::from_be_bytes([bytes[16], bytes[17], bytes[18], bytes[19]]);
    let height = u32::from_be_bytes([bytes[20], bytes[21], bytes[22], bytes[23]]);
    Ok((width, height))
}

#[tauri::command]
pub async fn browser_tabs(
    state: tauri::State<'_, BrowserAgentState>,
) -> Result<serde_json::Value, String> {
    let (client, _, _) = active_session(&state).await?;
    let targets = client
        .send("Target.getTargets", json!({}), None, COMMAND_TIMEOUT)
        .await?;
    let active = state
        .active_target
        .lock()
        .expect("active target lock")
        .clone();
    let tabs: Vec<serde_json::Value> = targets
        .get("targetInfos")
        .and_then(|infos| infos.as_array())
        .map(|infos| {
            infos
                .iter()
                .filter(|info| info.get("type").and_then(|t| t.as_str()) == Some("page"))
                .map(|info| {
                    json!({
                        "targetId": info.get("targetId").and_then(|id| id.as_str()).unwrap_or(""),
                        "url": info.get("url").and_then(|url| url.as_str()).unwrap_or(""),
                        "title": info.get("title").and_then(|title| title.as_str()).unwrap_or(""),
                        "active": info.get("targetId").and_then(|id| id.as_str()) == active.as_deref()
                    })
                })
                .collect()
        })
        .unwrap_or_default();
    tool_result(json!({ "tabs": tabs }))
}

#[tauri::command]
pub async fn browser_switch_tab(
    state: tauri::State<'_, BrowserAgentState>,
    target_id: String,
) -> Result<serde_json::Value, String> {
    let (client, _, _) = active_session(&state).await?;
    client
        .send(
            "Target.activateTarget",
            json!({ "targetId": target_id }),
            None,
            COMMAND_TIMEOUT,
        )
        .await?;
    *state.active_target.lock().expect("active target lock") = Some(target_id.clone());
    tool_result(json!({ "active": target_id }))
}

#[tauri::command]
pub async fn browser_close_tab(
    state: tauri::State<'_, BrowserAgentState>,
    target_id: String,
) -> Result<serde_json::Value, String> {
    let (client, _, _) = active_session(&state).await?;
    client
        .send(
            "Target.closeTarget",
            json!({ "targetId": target_id }),
            None,
            COMMAND_TIMEOUT,
        )
        .await?;
    state
        .sessions
        .lock()
        .expect("session lock")
        .remove(&target_id);
    if *state.active_target.lock().expect("active target lock") == Some(target_id.clone()) {
        *state.active_target.lock().expect("active target lock") = None;
    }
    tool_result(json!({ "closed": target_id }))
}

#[tauri::command]
pub async fn browser_wait(ms: Option<u64>) -> Result<serde_json::Value, String> {
    let bounded = ms.unwrap_or(500).min(10_000);
    tokio::time::sleep(Duration::from_millis(bounded)).await;
    tool_result(json!({ "waitedMs": bounded }))
}

#[tauri::command]
pub async fn browser_wait_for_load(
    state: tauri::State<'_, BrowserAgentState>,
    timeout_ms: Option<u64>,
) -> Result<serde_json::Value, String> {
    let (client, _target, session) = active_session(&state).await?;
    let timeout = Duration::from_millis(timeout_ms.unwrap_or(15_000).min(30_000));
    client
        .wait_for(CdpEventKind::LoadFired(session), timeout)
        .await?;
    tool_result(json!({ "loaded": true }))
}
