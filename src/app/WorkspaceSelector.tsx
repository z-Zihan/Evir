import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useWorkspaceStore } from "../features/workspace/workspace-store";

export function WorkspaceSelector() {
  const { t } = useTranslation();
  const { currentWorkspace, setWorkspace, clearWorkspace, recentWorkspaces, loadWorkspace } =
    useWorkspaceStore();

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
      <div className="flex items-center gap-2 px-4 py-2 border-b border-border bg-surface text-sm min-h-[40px]">
        <button
          type="button"
          className="border border-border bg-surface px-3 py-1 rounded text-xs whitespace-nowrap hover:border-primary hover:text-primary transition"
          onClick={() => void handleSelect()}
        >
          {t("workspace.select")}
        </button>
      </div>
    );
  }

  const shortPath = currentWorkspace.split("/").slice(-2).join("/");

  return (
    <div className="flex items-center gap-2 px-4 py-2 border-b border-border bg-surface text-sm min-h-[40px]">
      <span
        className="font-medium overflow-hidden text-ellipsis whitespace-nowrap max-w-[300px]"
        title={currentWorkspace}
      >
        📁 {shortPath}
      </span>
      <button
        type="button"
        className="border border-border bg-surface px-3 py-1 rounded text-xs whitespace-nowrap hover:border-primary hover:text-primary transition"
        onClick={() => void handleSelect()}
      >
        {t("workspace.change")}
      </button>
      <button
        type="button"
        className="border border-border px-1.5 py-0.5 text-base leading-none rounded hover:bg-surface-hover"
        onClick={clearWorkspace}
      >
        ×
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
  );
}
