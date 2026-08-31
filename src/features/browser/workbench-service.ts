/**
 * Browser Workbench service: the only place outside the runtime layer that
 * touches Tauri APIs for browsing. UI components consume these functions so
 * the app layer stays free of direct `@tauri-apps/*` imports (architecture
 * dependency direction: UI → Service → Runtime).
 */

export interface WorkbenchTab {
  id: number;
  url: string;
  title: string;
  active: boolean;
}

export interface ContentRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

async function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const { tauriInvoke } = await import("../../runtime/tauri-ipc");
  return tauriInvoke<T>(command, args);
}

export async function listWorkbenchTabs(): Promise<WorkbenchTab[]> {
  return invoke<WorkbenchTab[]>("browser_tab_list");
}

export async function openWorkbenchWindow(): Promise<void> {
  await invoke("browser_workbench_open");
}

export async function newTab(url: string): Promise<void> {
  await invoke("browser_tab_new", { url });
}

export async function activateTab(id: number): Promise<void> {
  await invoke("browser_tab_activate", { id });
}

export async function closeTab(id: number): Promise<void> {
  await invoke("browser_tab_close", { id });
}

export async function navigateTab(id: number, url: string): Promise<void> {
  await invoke("browser_tab_navigate", { id, url });
}

export async function tabHistory(
  id: number,
  direction: "back" | "forward" | "reload",
): Promise<void> {
  await invoke("browser_tab_history", { id, direction });
}

export async function updateContentLayout(rect: ContentRect): Promise<void> {
  await invoke("browser_layout_update", { ...rect });
}

export async function clearSiteData(): Promise<void> {
  await invoke("browser_clear_site_data");
}

/** Subscribes to tab updates emitted by the Rust layer. Returns a stop fn. */
export async function subscribeTabs(listener: (tabs: WorkbenchTab[]) => void): Promise<() => void> {
  const { listen } = await import("@tauri-apps/api/event");
  const unlisten = await listen<WorkbenchTab[]>("browser-workbench-tabs", (event) =>
    listener(event.payload),
  );
  return () => {
    void unlisten();
  };
}

/** Opens a URL in the user's default browser via the scoped shell permission. */
export async function openExternal(url: string): Promise<void> {
  const { open } = await import("@tauri-apps/plugin-shell");
  await open(url);
}
