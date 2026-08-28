// Runtime-layer Tauri bridge for MCP transports. core/mcp must stay Tauri-free
// (see the architecture test), so the desktop invoke/listen implementations
// live here and are injected into McpClient by create-runtime.
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export const tauriInvoke = invoke;
export const tauriListen = listen;
