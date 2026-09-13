import { lazy, Suspense, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { FileQuestion, LoaderCircle } from "lucide-react";
import { useWorkspacePanelStore } from "../../features/workspace/workspace-panel-store";
import { desktopStorage } from "../../runtime/desktop-storage-adapter";
import { relativeToRoot } from "../../features/workspace/workspace-services";
import { useActiveWorkspaceRoot } from "../../features/workspace/workspace-bridge";

// Canvas (React Flow) is a heavy surface: only this lazy chunk pulls
// @xyflow/react + its CSS, never the initial bundle (§83, CAN-2 keeps it).
const CanvasView = lazy(() =>
  import("../../features/canvas/CanvasView").then((m) => ({ default: m.default })),
);

function relative(path: string, root: string | null): string {
  const value = relativeToRoot(path, root);
  return value === "." ? path : value;
}

/**
 * Canvas workbench tab (CAN-2): renders the project's canvas documents in
 * the shared panel. The document shown is the one the agent last wrote
 * (panel-store canvasPath) or the first canvas found in the project; the
 * empty state is one honest sentence — no marketing art.
 */
export function CanvasTab() {
  const { t } = useTranslation();
  const root = useActiveWorkspaceRoot();
  const canvasPath = useWorkspacePanelStore((state) => state.canvasPath);
  const [canvases, setCanvases] = useState<string[] | null>(null);

  useEffect(() => {
    if (!root) {
      setCanvases(null);
      return;
    }
    let cancelled = false;
    // Depth-bounded workspace search; ".evir-canvas" matches the extension.
    desktopStorage
      .searchFiles(root, ".evir-canvas")
      .then((paths) => {
        if (cancelled) return;
        setCanvases(paths.filter((path) => path.toLowerCase().endsWith(".evir-canvas")));
      })
      .catch(() => {
        if (!cancelled) setCanvases([]);
      });
    return () => {
      cancelled = true;
    };
  }, [root]);

  const active = canvasPath ?? canvases?.[0] ?? null;

  if (active === null) {
    // Loading (null) vs genuinely empty ([]) get distinct but quiet states.
    if (canvases === null) {
      return (
        <div className="workspace-empty">
          <LoaderCircle size={20} className="spin" aria-hidden="true" />
          <p>{t("workspace.loading")}</p>
        </div>
      );
    }
    return (
      <div className="workspace-empty">
        <FileQuestion size={20} aria-hidden="true" />
        <p>{t("workspace.canvasEmptyTitle")}</p>
        <p className="text-[11.5px] text-muted">{t("workspace.canvasEmptyHint")}</p>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {(canvases?.length ?? 0) > 1 && (
        <label className="flex items-center gap-2 border-b border-border px-3 py-1.5 text-[11.5px]">
          <span className="text-muted">{t("workspace.canvasSwitcher")}</span>
          <select
            className="form-select h-7 max-w-[280px] rounded-lg border border-border bg-surface px-2 text-[11.5px]"
            value={active}
            onChange={(event) =>
              useWorkspacePanelStore.setState({ canvasPath: event.target.value })
            }
            aria-label={t("workspace.canvasSwitcher")}
          >
            {canvases?.map((path) => (
              <option key={path} value={path}>
                {relative(path, root)}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="min-h-0 flex-1">
        <Suspense
          fallback={
            <div className="workspace-empty">
              <LoaderCircle size={20} className="spin" aria-hidden="true" />
              <p>{t("preview.loading")}</p>
            </div>
          }
        >
          <CanvasView path={active} title={relative(active, root)} />
        </Suspense>
      </div>
    </div>
  );
}
