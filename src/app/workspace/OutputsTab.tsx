import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Copy,
  FileCode2,
  FolderSearch,
  ImageIcon,
  PackageOpen,
  SquareArrowOutUpRight,
  Workflow,
} from "lucide-react";
import {
  ItemInteractive,
  ItemMedia,
  ItemContent,
  ItemTitle,
  ItemDescription,
  Tip,
} from "../../components/ui";
import { copyTextWithFeedback } from "../../components/feedback";
import { useRunWorkspaceStore } from "../../features/workspace/workspace-run-store";
import { useActiveWorkspaceRoot } from "../../features/workspace/workspace-bridge";
import {
  openTaskOutput,
  taskOutputAbsolutePath,
} from "../../features/workspace/task-output-resource";
import {
  revealInFileManager,
  relativeToRoot,
  statFile,
} from "../../features/workspace/workspace-services";
import { logger } from "../../core/logging/logger";
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
  canvas: "CANVAS",
};

function typeChip(output: TaskOutput): string {
  return TYPE_CHIP[output.type] ?? output.type.toUpperCase();
}

function outputIcon(output: TaskOutput) {
  if (output.kind === "canvas") {
    return <Workflow size={15} aria-hidden="true" />;
  }
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
        const path = taskOutputAbsolutePath(output, root);
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
      <div className="workspace-empty flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center text-muted">
        <FolderSearch size={20} aria-hidden="true" />
        <p className="m-0 text-[12px]">{t("workspace.filesNoProject")}</p>
      </div>
    );
  }

  const relativeTime = (at: number): string => {
    const seconds = Math.max(0, Math.floor((Date.now() - at) / 1000));
    if (seconds < 60) return t("workspace.outputsJustNow");
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return t("workspace.outputsMinutesAgo", { count: minutes });
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return t("workspace.outputsHoursAgo", { count: hours });
    return t("workspace.outputsDaysAgo", { count: Math.floor(hours / 24) });
  };

  if (outputs.length === 0) {
    return (
      <div className="workspace-empty workspace-outputs-empty flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center text-muted">
        <PackageOpen size={22} aria-hidden="true" />
        <p className="m-0 text-[12.5px] font-medium">{t("workspace.outputsEmptyTitle")}</p>
        <p className="workspace-empty-hint m-0 text-[11.5px] text-muted">
          {t("workspace.outputsEmptyHint")}
        </p>
      </div>
    );
  }

  return (
    <div className="workspace-tab-scroll flex min-h-0 flex-1 flex-col overflow-y-auto p-2">
      <section
        className="workspace-outputs-primary flex flex-col gap-1.5"
        aria-label={t("workspace.outputsTitle")}
      >
        <header className="workspace-section-header flex items-baseline justify-between px-1">
          <h2 className="m-0 text-[12px] font-semibold text-foreground">
            {t("workspace.outputsTitle")}
          </h2>
          <span className="workspace-changes-summary text-[11px] text-muted">
            {t("workspace.outputsCount", { count: outputs.length })}
          </span>
        </header>
        <ul className="workspace-output-list-primary m-0 flex list-none flex-col gap-0.5 p-0">
          {outputs.map((output) => {
            const size = formatSize(sizes[output.id]);
            const absolutePath = taskOutputAbsolutePath(output, root);
            return (
              <li key={output.id}>
                <Tip content={output.path}>
                  <ItemInteractive
                    className="workspace-output-row-primary group/row"
                    onClick={() => openTaskOutput(output, root)}
                  >
                    <ItemMedia className="workspace-output-icon text-muted">
                      {outputIcon(output)}
                    </ItemMedia>
                    <ItemContent className="workspace-output-copy">
                      <ItemTitle className="workspace-output-name">
                        {output.path.split("/").pop() ?? output.path}
                      </ItemTitle>
                      <ItemDescription className="workspace-output-meta">
                        {[
                          relativeTime(output.createdAt),
                          size,
                          output.kind === "screenshot"
                            ? t("workspace.outputsScreenshot")
                            : relativeToRoot(output.path, root),
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </ItemDescription>
                    </ItemContent>
                    {absolutePath && (
                      <span className="workspace-output-actions ml-1 flex shrink-0 items-center gap-0.5">
                        <Tip content={t("workspace.copyPath")}>
                          <button
                            type="button"
                            className="grid size-6 cursor-pointer place-items-center rounded-md text-muted hover:bg-surface-hover hover:text-foreground"
                            aria-label={t("workspace.copyPath")}
                            onClick={(event) => {
                              event.stopPropagation();
                              void copyTextWithFeedback(absolutePath, {
                                successKey: "workspace.pathCopied",
                              });
                            }}
                          >
                            <Copy size={12} aria-hidden="true" />
                          </button>
                        </Tip>
                        {output.kind !== "screenshot" && (
                          <Tip content={t("workspace.revealInFinder")}>
                            <button
                              type="button"
                              className="grid size-6 cursor-pointer place-items-center rounded-md text-muted hover:bg-surface-hover hover:text-foreground"
                              aria-label={t("workspace.revealInFinder")}
                              onClick={(event) => {
                                event.stopPropagation();
                                logger.info("ui", "ui.output.reveal", {
                                  actionId: crypto.randomUUID(),
                                  path: absolutePath,
                                });
                                void revealInFileManager(absolutePath).catch(() => undefined);
                              }}
                            >
                              <SquareArrowOutUpRight size={12} aria-hidden="true" />
                            </button>
                          </Tip>
                        )}
                      </span>
                    )}
                    <span className="workspace-output-chip ml-auto shrink-0 rounded-full border border-border bg-surface-hover px-1.5 py-px text-[9.5px] font-semibold tracking-wide text-muted">
                      {typeChip(output)}
                    </span>
                  </ItemInteractive>
                </Tip>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
