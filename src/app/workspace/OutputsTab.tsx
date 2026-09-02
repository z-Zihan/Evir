import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { FileCode2, FolderSearch, ImageIcon, PackageOpen } from "lucide-react";
import { useRunWorkspaceStore } from "../../features/workspace/workspace-run-store";
import { useWorkspacePanelStore } from "../../features/workspace/workspace-panel-store";
import { useActiveWorkspaceRoot } from "../../features/workspace/workspace-bridge";
import {
  relativeToRoot,
  resolveWorkspacePath,
  statFile,
} from "../../features/workspace/workspace-services";
import type { TaskOutput } from "../../features/workspace/task-output-model";

/** Type chip labels shown next to each output row. */
const TYPE_CHIP: Record<string, string> = {
  html: "HTML",
  htm: "HTML",
  svg: "SVG",
  pdf: "PDF",
  png: "PNG",
  jpg: "JPG",
  jpeg: "JPG",
  gif: "GIF",
  webp: "WEBP",
  md: "MD",
  markdown: "MD",
  csv: "CSV",
  tsv: "TSV",
  json: "JSON",
  mermaid: "MERMAID",
  mmd: "MERMAID",
  dot: "GRAPHVIZ",
};

function typeChip(output: TaskOutput): string {
  return TYPE_CHIP[output.type] ?? output.type.toUpperCase();
}

function outputIcon(output: TaskOutput) {
  if (
    output.kind === "screenshot" ||
    output.type === "png" ||
    output.type === "jpg" ||
    output.type === "jpeg"
  ) {
    return <ImageIcon size={15} aria-hidden="true" />;
  }
  return <FileCode2 size={15} aria-hidden="true" />;
}

function formatSize(bytes: number | undefined): string | null {
  if (bytes === undefined || bytes < 0) return null;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatRelativeTime(
  t: (key: string, options?: Record<string, unknown>) => string,
  at: number,
): string {
  const seconds = Math.max(0, Math.floor((Date.now() - at) / 1000));
  if (seconds < 60) return t("workspace.outputsJustNow");
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return t("workspace.outputsMinutesAgo", { count: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t("workspace.outputsHoursAgo", { count: hours });
  return t("workspace.outputsDaysAgo", { count: Math.floor(hours / 24) });
}

function openOutputResource(output: TaskOutput, root: string | null) {
  const { openResource } = useWorkspacePanelStore.getState();
  if (output.kind === "screenshot") {
    const label = output.path.split("/").pop();
    openResource({ kind: "screenshot", path: output.path, ...(label ? { label } : {}) });
    return;
  }
  const path = resolveWorkspacePath(output.path, root);
  if (!path) return;
  openResource({
    kind: "file",
    path,
    ...(output.mimeType ? { mimeType: output.mimeType } : {}),
  });
}

/**
 * Outputs tab — this task's deliverables as a first-class list (§19-23).
 * Rows are desktop-resource style: type chip, name, size · generated-at.
 * Clicking opens the typed preview (HTML renders, CSV tables, images, PDF).
 */
export function OutputsTab() {
  const { t } = useTranslation();
  const root = useActiveWorkspaceRoot();
  const outputs = useRunWorkspaceStore((state) => state.outputs);
  const [sizes, setSizes] = useState<Record<string, number | undefined>>({});

  // File sizes are fetched lazily and bounded: long lists stay cheap.
  useEffect(() => {
    let cancelled = false;
    const targets = outputs.slice(0, 20);
    void Promise.all(
      targets.map(async (output) => {
        const path = resolveWorkspacePath(output.path, root);
        if (!path || output.kind === "screenshot") return [output.id, undefined] as const;
        try {
          const stat = await statFile(path);
          return [output.id, stat.exists && stat.is_file ? stat.size : undefined] as const;
        } catch {
          return [output.id, undefined] as const;
        }
      }),
    ).then((entries) => {
      if (cancelled) return;
      setSizes(Object.fromEntries(entries));
    });
    return () => {
      cancelled = true;
    };
  }, [outputs, root]);

  if (!root) {
    return (
      <div className="workspace-empty">
        <FolderSearch size={20} aria-hidden="true" />
        <p>{t("workspace.filesNoProject")}</p>
      </div>
    );
  }

  if (outputs.length === 0) {
    return (
      <div className="workspace-empty workspace-outputs-empty">
        <PackageOpen size={22} aria-hidden="true" />
        <p>{t("workspace.outputsEmptyTitle")}</p>
        <p className="workspace-empty-hint">{t("workspace.outputsEmptyHint")}</p>
      </div>
    );
  }

  return (
    <div className="workspace-tab-scroll">
      <section className="workspace-outputs-primary" aria-label={t("workspace.outputsTitle")}>
        <header className="workspace-section-header">
          <h2>{t("workspace.outputsTitle")}</h2>
          <span className="workspace-changes-summary">
            {t("workspace.outputsCount", { count: outputs.length })}
          </span>
        </header>
        <ul className="workspace-output-list-primary">
          {outputs.map((output) => {
            const size = formatSize(sizes[output.id]);
            return (
              <li key={output.id}>
                <button
                  type="button"
                  className="workspace-output-row-primary"
                  onClick={() => openOutputResource(output, root)}
                  data-tip={output.path}
                >
                  <span className="workspace-output-icon">{outputIcon(output)}</span>
                  <span className="workspace-output-copy">
                    <span className="workspace-output-name">
                      {output.path.split("/").pop() ?? output.path}
                    </span>
                    <span className="workspace-output-meta">
                      {[
                        formatRelativeTime(t, output.createdAt),
                        size,
                        output.kind === "screenshot"
                          ? t("workspace.outputsScreenshot")
                          : relativeToRoot(output.path, root),
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </span>
                  <span className="workspace-output-chip">{typeChip(output)}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
