import { useTranslation } from "react-i18next";
import { useWorkspaceStore } from "../features/workspace/workspace-store";

export function WorkspaceSelector() {
  const { t } = useTranslation();
  const { currentWorkspace, setWorkspace, clearWorkspace, recentWorkspaces } = useWorkspaceStore();

  async function handleSelect() {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({ directory: true, multiple: false });
      if (typeof selected === "string") setWorkspace(selected);
    } catch {
      // Not in desktop mode or dialog cancelled
    }
  }

  if (!currentWorkspace) {
    return (
      <div className="workspace-selector">
        <button type="button" className="workspace-pick" onClick={() => void handleSelect()}>
          {t("workspace.select")}
        </button>
      </div>
    );
  }

  const shortPath = currentWorkspace.split("/").slice(-2).join("/");

  return (
    <div className="workspace-selector">
      <span className="workspace-current" title={currentWorkspace}>
        📁 {shortPath}
      </span>
      <button type="button" className="workspace-change" onClick={() => void handleSelect()}>
        {t("workspace.change")}
      </button>
      <button type="button" className="workspace-clear" onClick={clearWorkspace}>
        ×
      </button>
      {recentWorkspaces.length > 1 && (
        <details className="workspace-recent">
          <summary>{t("workspace.recent")}</summary>
          {recentWorkspaces
            .filter((p) => p !== currentWorkspace)
            .map((p) => (
              <button key={p} type="button" onClick={() => setWorkspace(p)} title={p}>
                {p.split("/").slice(-2).join("/")}
              </button>
            ))}
        </details>
      )}
    </div>
  );
}
