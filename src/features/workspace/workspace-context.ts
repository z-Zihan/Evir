import { useWorkspacePanelStore } from "./workspace-panel-store";

/**
 * Workspace context collection for outgoing messages: the user's current
 * work objects only — never file contents (§35). The agent reads specific
 * content through tools when needed.
 */

export function collectWorkspaceContext(now = Date.now()): string[] {
  const panel = useWorkspacePanelStore.getState();
  const lines: string[] = [];
  if (panel.open && panel.activeTab === "preview" && panel.activeResource) {
    const resource = panel.activeResource;
    if (resource.kind === "file" || resource.kind === "diff") {
      lines.push(`user is currently viewing file: ${resource.path}`);
    } else if (resource.kind === "url") {
      lines.push(`user is currently viewing url: ${resource.uri}`);
    } else if (resource.kind === "screenshot") {
      lines.push(`user is currently viewing screenshot: ${resource.path}`);
    } else if (resource.kind === "artifact") {
      lines.push(
        `user is currently viewing an artifact (${resource.language}) from the conversation`,
      );
    }
  }
  if (panel.open && panel.activeTab === "browser" && panel.browserContextUrl) {
    lines.push(
      `user is currently looking at the workspace browser page: ${panel.browserContextUrl} (feedback like "this button is too wide" refers to that page)`,
    );
  }
  return lines.map((line) => `${line} [viewed at ${now}]`);
}
