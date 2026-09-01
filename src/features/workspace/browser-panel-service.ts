import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

/**
 * Service for the workspace Browser surface. Content webviews are native
 * children of the main window positioned over the browser tab area; the
 * chrome (this panel) reports its content rect and visibility so Rust can
 * place/hide them. Content webviews hold zero Tauri capabilities — the same
 * security boundary as the standalone workbench window (§56–57).
 */

export interface PanelBrowserTab {
  id: number;
  url: string;
  title: string;
  active: boolean;
}

export function panelTabList(): Promise<PanelBrowserTab[]> {
  return invoke("browser_panel_tab_list");
}

export function panelTabNew(url: string): Promise<PanelBrowserTab> {
  return invoke("browser_panel_tab_new", { url });
}

export function panelTabActivate(id: number): Promise<void> {
  return invoke("browser_panel_tab_activate", { id });
}

export function panelTabClose(id: number): Promise<void> {
  return invoke("browser_panel_tab_close", { id });
}

export function panelTabNavigate(id: number, url: string): Promise<void> {
  return invoke("browser_panel_tab_navigate", { id, url });
}

export function panelTabHistory(
  id: number,
  direction: "back" | "forward" | "reload",
): Promise<void> {
  return invoke("browser_panel_tab_history", { id, direction });
}

export interface PanelBrowserLayout {
  x: number;
  y: number;
  width: number;
  height: number;
  visible: boolean;
}

/**
 * Report the browser content area (CSS px relative to the main window) and
 * whether the surface is visible. Hidden whenever the workspace panel is
 * closed, another tab is active, or a full-screen overlay would be covered
 * by the native webview layer.
 */
export function panelLayoutUpdate(layout: PanelBrowserLayout): Promise<void> {
  return invoke("browser_panel_layout_update", { ...layout });
}

export function subscribePanelTabs(
  handler: (tabs: PanelBrowserTab[]) => void,
): Promise<() => void> {
  return listen<PanelBrowserTab[]>("browser-panel-tabs", (event) => handler(event.payload));
}

/**
 * Read a saved agent-browser screenshot (base64 PNG). The Rust side
 * validates the path stays inside the managed screenshots directory.
 */
export function readScreenshotBase64(path: string): Promise<string> {
  return invoke("browser_screenshot_read", { path });
}
