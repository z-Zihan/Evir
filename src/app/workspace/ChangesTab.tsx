import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Copy, GitCompareArrows } from "lucide-react";
import { ItemInteractive, ItemMedia, Tip } from "../../components/ui";
import { notify } from "../../components/feedback";
import { useRunWorkspaceStore } from "../../features/workspace/workspace-run-store";
import { useWorkspacePanelStore } from "../../features/workspace/workspace-panel-store";
import {
  gitDiffFor,
  readTextFile,
  relativeToRoot,
  resolveWorkspacePath,
} from "../../features/workspace/workspace-services";
import {
  countDiffLines,
  filterUnifiedDiffByFile,
  synthesizeAddedDiff,
} from "../../features/workspace/changes-model";
import { useActiveWorkspaceRoot } from "../../features/workspace/workspace-bridge";

/**
 * Live list of the run's file mutations. Every successful write_file /
 * apply_patch / restore_snapshot lands here through the tool-event bus —
 * no refresh, no page reload (§10). Diff-as-a-first-class-object (§30):
 * per-file diffstat, click-to-diff, copy-patch per file.
 */
export function ChangesTab() {
  const { t } = useTranslation();
  const changes = useRunWorkspaceStore((state) => state.changes);
  const runId = useRunWorkspaceStore((state) => state.runId);
  const openResource = useWorkspacePanelStore((state) => state.openResource);
  const root = useActiveWorkspaceRoot();
  const [total, setTotal] = useState<{ additions: number; deletions: number } | null>(null);
  const [perFile, setPerFile] = useState<Record<string, { additions: number; deletions: number }>>(
    {},
  );
  const [repoDiff, setRepoDiff] = useState("");

  // Per-file +/- counts come from the repo diff when one exists; recomputed
  // when the change list settles so rows can show "+24 −8" (§27/§30).
  useEffect(() => {
    let cancelled = false;
    if (changes.length === 0) {
      setTotal(null);
      setPerFile({});
      setRepoDiff("");
      return;
    }
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const counts: Record<string, { additions: number; deletions: number }> = {};
          let additions = 0;
          let deletions = 0;
          let diff = "";
          try {
            diff = root ? await gitDiffFor(root) : "";
          } catch {
            diff = "";
          }
          for (const change of changes) {
            const relative = relativeToRoot(change.path, root);
            const section = diff ? filterUnifiedDiffByFile(diff, relative) : "";
            if (section) {
              const counted = countDiffLines(section);
              counts[change.path] = counted;
              additions += counted.additions;
              deletions += counted.deletions;
              continue;
            }
            if (change.changeType === "added") {
              try {
                const resolvedPath = resolveWorkspacePath(change.path, root);
                if (!resolvedPath) continue;
                const content = await readTextFile(resolvedPath);
                const lines = content.split("\n").filter((line) => line !== "").length;
                counts[change.path] = { additions: lines, deletions: 0 };
                additions += lines;
              } catch {
                // file may be gone already
              }
            }
          }
          if (!cancelled) {
            setTotal({ additions, deletions });
            setPerFile(counts);
            setRepoDiff(diff);
          }
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

  const copyPatch = async (path: string, changeType: string) => {
    try {
      const relative = relativeToRoot(path, root);
      const section = repoDiff ? filterUnifiedDiffByFile(repoDiff, relative) : "";
      const patch =
        section ||
        (changeType === "added"
          ? synthesizeAddedDiff(
              path,
              await readTextFile(resolveWorkspacePath(path, root) ?? path).catch(() => ""),
            )
          : "");
      if (!patch) {
        notify.warning(t("workspace.noPatchAvailable"));
        return;
      }
      await navigator.clipboard.writeText(patch);
      notify.success(t("workspace.patchCopied"));
    } catch {
      notify.error(t("workspace.noPatchAvailable"));
    }
  };

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
          {changes.map((change) => {
            const counts = perFile[change.path];
            return (
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
                    {counts && (
                      <span className="shrink-0 font-mono text-[10.5px]">
                        <span className="text-success">+{counts.additions}</span>{" "}
                        <span className="text-danger">−{counts.deletions}</span>
                      </span>
                    )}
                    <button
                      type="button"
                      className="workspace-change-copy grid size-5 shrink-0 cursor-pointer place-items-center rounded text-muted transition-colors hover:bg-surface-hover hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus"
                      aria-label={t("workspace.copyPatch")}
                      title={t("workspace.copyPatch")}
                      onClick={(event) => {
                        event.stopPropagation();
                        void copyPatch(change.path, change.changeType);
                      }}
                    >
                      <Copy size={11} aria-hidden="true" />
                    </button>
                  </ItemInteractive>
                </Tip>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
