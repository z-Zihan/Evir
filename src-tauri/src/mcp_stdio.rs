use crate::mcp_stdio_process::{McpProcessHandle, McpProcessSpec};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, State};

const DEFAULT_REQUEST_TIMEOUT_MS: u64 = 60_000;
const MAX_REQUEST_TIMEOUT_MS: u64 = 10 * 60_000;

#[derive(Default)]
pub(crate) struct McpStdioState {
    processes: Mutex<HashMap<String, Arc<McpProcessHandle>>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct McpStdioStartResult {
    pid: u32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct McpStdioStatus {
    running: bool,
    pid: u32,
    exit_code: Option<i32>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct McpStdioNotification {
    server_id: String,
    message: Value,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct McpStdioStartRequest {
    server_id: String,
    command: String,
    args: Vec<String>,
    cwd: Option<String>,
    env: HashMap<String, String>,
}

fn validate_server_id(server_id: &str) -> Result<(), String> {
    if server_id.is_empty()
        || server_id.len() > 128
        || !server_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.'))
    {
        return Err("invalid MCP server id".to_owned());
    }
    Ok(())
}

#[tauri::command]
pub(crate) fn mcp_stdio_start(
    app: AppHandle,
    state: State<'_, McpStdioState>,
    request: McpStdioStartRequest,
) -> Result<McpStdioStartResult, String> {
    validate_server_id(&request.server_id)?;
    let mut processes = state
        .processes
        .lock()
        .map_err(|_| "MCP process registry is poisoned".to_owned())?;
    if processes.contains_key(&request.server_id) {
        return Err("MCP server is already running".to_owned());
    }
    let server_id = request.server_id.clone();
    let event_server_id = server_id.clone();
    let notify = Arc::new(move |message: Value| {
        let _ = app.emit(
            "mcp-stdio-notification",
            McpStdioNotification {
                server_id: event_server_id.clone(),
                message,
            },
        );
    });
    let handle = Arc::new(McpProcessHandle::spawn(
        McpProcessSpec {
            command: request.command,
            args: request.args,
            cwd: request.cwd,
            env: request.env,
        },
        notify,
    )?);
    let pid = handle.pid()?;
    processes.insert(server_id, handle);
    Ok(McpStdioStartResult { pid })
}

fn get_process(
    state: &State<'_, McpStdioState>,
    server_id: &str,
) -> Result<Arc<McpProcessHandle>, String> {
    validate_server_id(server_id)?;
    state
        .processes
        .lock()
        .map_err(|_| "MCP process registry is poisoned".to_owned())?
        .get(server_id)
        .cloned()
        .ok_or_else(|| "MCP server is not running".to_owned())
}

/// Drop a dead server from the registry. Dropping the handle reaps the child
/// (Drop terminates), so exited servers stop shadowing restarts with
/// "already running" and stop holding zombie processes.
fn prune_exited(state: &State<'_, McpStdioState>, server_id: &str) {
    if let Ok(mut processes) = state.processes.lock() {
        let dead = processes
            .get(server_id)
            .map(|handle| {
                handle
                    .status()
                    .map(|status| !status.running)
                    .unwrap_or(true)
            })
            .unwrap_or(false);
        if dead {
            processes.remove(server_id);
        }
    }
}

#[tauri::command]
pub(crate) async fn mcp_stdio_request(
    state: State<'_, McpStdioState>,
    server_id: String,
    request: Value,
    timeout_ms: Option<u64>,
) -> Result<Value, String> {
    let timeout = timeout_ms
        .unwrap_or(DEFAULT_REQUEST_TIMEOUT_MS)
        .clamp(1, MAX_REQUEST_TIMEOUT_MS);
    let process = get_process(&state, &server_id)?;
    let result = tauri::async_runtime::spawn_blocking(move || process.request(request, timeout))
        .await
        .map_err(|error| error.to_string())?;
    if matches!(&result, Err(error) if error.contains("MCP server exited")) {
        prune_exited(&state, &server_id);
    }
    result
}

#[tauri::command]
pub(crate) async fn mcp_stdio_send(
    state: State<'_, McpStdioState>,
    server_id: String,
    message: Value,
) -> Result<(), String> {
    let process = get_process(&state, &server_id)?;
    let result = tauri::async_runtime::spawn_blocking(move || process.send(message))
        .await
        .map_err(|error| error.to_string())?;
    if matches!(&result, Err(error) if error.contains("MCP server exited")) {
        prune_exited(&state, &server_id);
    }
    result
}

#[tauri::command]
pub(crate) async fn mcp_stdio_status(
    state: State<'_, McpStdioState>,
    server_id: String,
) -> Result<McpStdioStatus, String> {
    let process = get_process(&state, &server_id)?;
    let status = tauri::async_runtime::spawn_blocking(move || process.status())
        .await
        .map_err(|error| error.to_string())??;
    if !status.running {
        prune_exited(&state, &server_id);
    }
    Ok(McpStdioStatus {
        running: status.running,
        pid: status.pid,
        exit_code: status.exit_code,
    })
}

#[tauri::command]
pub(crate) async fn mcp_stdio_stop(
    state: State<'_, McpStdioState>,
    server_id: String,
) -> Result<bool, String> {
    validate_server_id(&server_id)?;
    let handle = state
        .processes
        .lock()
        .map_err(|_| "MCP process registry is poisoned".to_owned())?
        .remove(&server_id);
    let Some(handle) = handle else {
        return Ok(false);
    };
    tauri::async_runtime::spawn_blocking(move || handle.stop())
        .await
        .map_err(|error| error.to_string())??;
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::validate_server_id;

    #[test]
    fn server_ids_are_bounded_and_safe() {
        assert!(validate_server_id("filesystem-1.local").is_ok());
        assert!(validate_server_id("").is_err());
        assert!(validate_server_id("bad/id").is_err());
        assert!(validate_server_id(&"a".repeat(129)).is_err());
    }
}
