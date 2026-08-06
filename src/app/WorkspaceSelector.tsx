import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { FolderOpen, X } from "lucide-react";
import { useWorkspaceStore } from "../features/workspace/workspace-store";
import { useConfirmationDialog } from "./useConfirmationDialog";

export function WorkspaceSelector() {
  const { t } = useTranslation();
  const { currentWorkspace, setWorkspace, clearWorkspace, recentWorkspaces, loadWorkspace } =
    useWorkspaceStore();
  const { requestConfirmation, confirmationDialog } = useConfirmationDialog();

  useEffect(() => {
    loadWorkspace();
  }, [loadWorkspace]);

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
        <button type="button" className="workspace-trigger" onClick={() => void handleSelect()}>
          <FolderOpen size={14} aria-hidden="true" />
          {t("workspace.select")}
        </button>
      </div>
    );
  }

  const shortPath = currentWorkspace.split("/").slice(-2).join("/");

  return (
    <>
      <div className="workspace-selector">
        <span className="workspace-path" title={currentWorkspace}>
          <FolderOpen size={14} aria-hidden="true" /> {shortPath}
        </span>
        <button type="button" className="workspace-trigger" onClick={() => void handleSelect()}>
          {t("workspace.change")}
        </button>
        <button
          type="button"
          className="workspace-clear"
          onClick={() =>
            requestConfirmation(
              {
                title: t("confirmation.clearTitle"),
                description: t("confirmation.workspaceDescription"),
                confirmLabel: t("workspace.clear"),
              },
              clearWorkspace,
            )
          }
          aria-label={t("workspace.clear")}
        >
          <X size={14} />
        </button>
        {recentWorkspaces.length > 1 && (
          <details className="relative">
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
      {confirmationDialog}
    </>
  );
}
