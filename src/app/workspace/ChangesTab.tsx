import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { GitCompareArrows } from "lucide-react";
import { ItemInteractive, ItemMedia, Tip } from "../../components/ui";
import { useRunWorkspaceStore } from "../../features/workspace/workspace-run-store";
import { useWorkspacePanelStore } from "../../features/workspace/workspace-panel-store";
import { relativeToRoot, resolveWorkspacePath } from "../../features/workspace/workspace-services";
import { useActiveWorkspaceRoot } from "../../features/workspace/workspace-bridge";

/**
 * Live list of the run's file mutations. Every successful write_file /
 * apply_patch / restore_snapshot lands here through the tool-event bus —
 * no refresh, no page reload (§10).
 */
export function ChangesTab() {
  const { t } = useTranslation();
  const changes = useRunWorkspaceStore((state) => state.changes);
  const runId = useRunWorkspaceStore((state) => state.runId);
  const openResource = useWorkspacePanelStore((state) => state.openResource);
  const root = useActiveWorkspaceRoot();
  const [total, setTotal] = useState<{ additions: number; deletions: number } | null>(null);

  // Aggregate +/- counts come from the repo diff when one exists; recomputed
  // when the change list settles so the header can show "+238 −71".
  useEffect(() => {
    let cancelled = false;
    if (changes.length === 0) {
      setTotal(null);
      return;
    }
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const { summarizeRunChanges } =
            await import("../../features/workspace/workspace-services");
          const summary = await summarizeRunChanges({ id: runId ?? "" }, changes, root);
          if (!cancelled) setTotal({ additions: summary.additions, deletions: summary.deletions });
        } catch {
          if (!cancelled) setTotal(null);
        }
      })();
    }, 400);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [changes, runId, root]);

  return (
    <div className="workspace-tab-scroll flex min-h-0 flex-1 flex-col overflow-y-auto p-2">
      <header className="workspace-section-header flex items-baseline justify-between px-1">
        <h2 className="m-0 text-[12px] font-semibold text-foreground">
          {t("workspace.changesTitle")}
        </h2>
        {changes.length > 0 && (
          <span className="workspace-changes-summary text-[11px] text-muted">
            {t("workspace.filesChanged", { count: changes.length })}
            {total && ` · +${total.additions} −${total.deletions}`}
          </span>
        )}
      </header>
      {changes.length === 0 ? (
        <div className="workspace-empty flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center text-muted">
          <GitCompareArrows size={20} aria-hidden="true" />
          <p className="m-0 text-[12px]">{t("workspace.changesEmpty")}</p>
        </div>
      ) : (
        <ul
          className="workspace-change-list m-0 flex list-none flex-col gap-0.5 p-0"
          aria-label={t("workspace.changesTitle")}
        >
          {changes.map((change) => (
            <li key={change.path}>
              <Tip content={change.path}>
                <ItemInteractive
                  className="workspace-change-row"
                  onClick={() => {
                    const path = resolveWorkspacePath(change.path, root);
                    if (!path) return;
                    openResource({
                      kind: "diff",
                      path,
                      ...(change.runId ? { runId: change.runId } : {}),
                    });
                  }}
                >
                  <ItemMedia className="workspace-change-icon text-muted">
                    <span
                      className={`workspace-change-letter ${change.changeType} grid size-4 place-items-center rounded text-[9.5px] font-bold ${
                        change.changeType === "added"
                          ? "bg-success/15 text-success"
                          : "bg-primary/12 text-primary"
                      }`}
                      aria-hidden="true"
                    >
                      {change.changeType === "added" ? "A" : "M"}
                    </span>
                  </ItemMedia>
                  <span className="workspace-change-path min-w-0 flex-1 truncate font-mono text-[11.5px]">
                    {relativeToRoot(change.path, root)}
                  </span>
                </ItemInteractive>
              </Tip>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
