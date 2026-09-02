import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { FilePlus2, FilePen, GitCompareArrows } from "lucide-react";
import { useRunWorkspaceStore } from "../../features/workspace/workspace-run-store";
import { useWorkspacePanelStore } from "../../features/workspace/workspace-panel-store";
import { relativeToRoot, resolveWorkspacePath } from "../../features/workspace/workspace-services";
import { useActiveWorkspaceRoot } from "../../features/workspace/workspace-bridge";
import type { ChangeEntry } from "../../features/workspace/changes-model";

function changeIcon(changeType: ChangeEntry["changeType"]) {
  return changeType === "added" ? (
    <FilePlus2 size={14} aria-hidden="true" />
  ) : (
    <FilePen size={14} aria-hidden="true" />
  );
}

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
    <div className="workspace-tab-scroll">
      <header className="workspace-section-header">
        <h2>{t("workspace.changesTitle")}</h2>
        {changes.length > 0 && (
          <span className="workspace-changes-summary">
            {t("workspace.filesChanged", { count: changes.length })}
            {total && ` · +${total.additions} −${total.deletions}`}
          </span>
        )}
      </header>
      {changes.length === 0 ? (
        <div className="workspace-empty">
          <GitCompareArrows size={20} aria-hidden="true" />
          <p>{t("workspace.changesEmpty")}</p>
        </div>
      ) : (
        <ul className="workspace-change-list" aria-label={t("workspace.changesTitle")}>
          {changes.map((change) => (
            <li key={change.path}>
              <button
                type="button"
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
                data-tip={change.path}
              >
                <span className={`workspace-change-letter ${change.changeType}`} aria-hidden="true">
                  {change.changeType === "added" ? "A" : "M"}
                </span>
                <span className="workspace-change-icon">{changeIcon(change.changeType)}</span>
                <span className="workspace-change-path">{relativeToRoot(change.path, root)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
