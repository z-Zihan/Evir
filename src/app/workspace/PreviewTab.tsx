import { lazy, Suspense, useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  ChevronLeft,
  ChevronRight,
  Copy,
  Eye,
  FileArchive,
  FileQuestion,
  LoaderCircle,
  Pin,
  PinOff,
  SquareArrowOutUpRight,
} from "lucide-react";
import { Button, Tabs, TabsList, TabsTab, Tip } from "../../components/ui";
import { copyTextWithFeedback } from "../../components/feedback";
import { useWorkspacePanelStore } from "../../features/workspace/workspace-panel-store";
import {
  workspaceResourceKey,
  workspaceResourceTitle,
} from "../../features/workspace/resource-model";
import { useRunWorkspaceStore } from "../../features/workspace/workspace-run-store";
import {
  revealInFileManager,
  resolveWorkspacePath,
} from "../../features/workspace/workspace-services";
import { useActiveWorkspaceRoot } from "../../features/workspace/workspace-bridge";
import { useProjectStore } from "../../features/projects/project-store";
import { useDevServerUi, appPreviewStatus, openUrlInPanelBrowser } from "./use-dev-server-ui";
import { AppPreviewCard } from "./AppPreviewCard";
import { useResolvedResource, type BinaryMeta } from "./use-resolved-resource";

import { normalizeFenceLanguage } from "../../features/preview/preview-registry";
import { ArtifactPreview } from "../../features/preview/ArtifactPreview";
import { isHighlightable, useShikiHighlight } from "../../features/preview/use-shiki";

const DiffPreview = lazy(() =>
  import("../../features/preview/renderers/DiffPreview").then((m) => ({ default: m.DiffPreview })),
);

// Canvas (React Flow) is a heavy surface: only this lazy chunk pulls
// @xyflow/react + its CSS, never the initial bundle (§83).
const CanvasView = lazy(() => import("../../features/canvas/CanvasView"));

function CodeView({ text, language }: { text: string; language: string }) {
  const normalized = normalizeFenceLanguage(language);
  const { html, error } = useShikiHighlight(text, normalized, false);
  if (error || html === null || !isHighlightable(text)) {
    return (
      <pre className="workspace-code-pre">
        <code>{text}</code>
      </pre>
    );
  }
  return <div className="workspace-code-highlight" dangerouslySetInnerHTML={{ __html: html }} />;
}

function ResourceEmpty({ controller }: { controller: ReturnType<typeof useDevServerUi> }) {
  const { t } = useTranslation();
  const root = useActiveWorkspaceRoot();
  const projects = useProjectStore((state) => state.projects);
  const currentProjectId = useProjectStore((state) => state.currentProjectId);
  const project = projects.find(({ id }) => id === currentProjectId);

  return (
    <div className="workspace-preview-empty">
      <section className="workspace-preview-empty-block">
        <Eye size={20} aria-hidden="true" />
        <h3>{t("workspace.previewFileTitle")}</h3>
        <p>{t("workspace.previewEmpty")}</p>
      </section>
      {root && <AppPreviewCard controller={controller} project={project} />}
    </div>
  );
}

/** Binary/opaque file metadata card (§20): type + size + how to open it. */
function BinaryMetaCard({ meta }: { meta: BinaryMeta }) {
  const { t } = useTranslation();
  const formatSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  };
  const name = meta.path.replace(/\\/g, "/").split("/").pop() ?? meta.path;
  return (
    <div className="workspace-binary-meta">
      <FileArchive size={20} aria-hidden="true" />
      <p className="workspace-binary-meta-name">{name}</p>
      <p className="workspace-binary-meta-detail">
        {meta.extension.toUpperCase()} · {formatSize(meta.size)}
        {meta.modified !== null
          ? ` · ${t("workspace.binaryModified", { time: new Date(meta.modified).toLocaleString() })}`
          : ""}
      </p>
      <p className="workspace-binary-meta-hint">{t("workspace.binaryHint")}</p>
    </div>
  );
}

function ResourceError({ message }: { message: string }) {
  const { t } = useTranslation();
  const key =
    message === "artifact-unavailable"
      ? "workspace.artifactUnavailable"
      : "workspace.previewFailed";
  return (
    <div className="workspace-empty error">
      <FileQuestion size={20} aria-hidden="true" />
      <p>{t(key)}</p>
    </div>
  );
}

/**
 * The preview tab renders the activeResource with the existing preview
 * registry — file/artifact/diff/screenshot all flow through one header with
 * back/forward history, pin, source attribution, copy-path/reveal actions,
 * and the Code/Preview mode toggle.
 */
export function PreviewTab() {
  const { t } = useTranslation();
  const activeResource = useWorkspacePanelStore((state) => state.activeResource);
  const viewMode = useWorkspacePanelStore((state) => state.viewMode);
  const setViewMode = useWorkspacePanelStore((state) => state.setViewMode);
  const goBack = useWorkspacePanelStore((state) => state.goBack);
  const goForward = useWorkspacePanelStore((state) => state.goForward);
  const canGoBack = useWorkspacePanelStore((state) => state.historyIndex > 0);
  const canGoForward = useWorkspacePanelStore(
    (state) => state.historyIndex < state.history.length - 1,
  );
  const pinnedKey = useWorkspacePanelStore((state) => state.pinnedKey);
  const togglePin = useWorkspacePanelStore((state) => state.togglePin);
  const changes = useRunWorkspaceStore((state) => state.changes);
  const devController = useDevServerUi();
  const root = useActiveWorkspaceRoot();
  const { state, content } = useResolvedResource(activeResource, root, changes);

  const mode = useMemo(() => {
    if (!content) return "code" as const;
    if (content.binaryMeta) return "preview" as const;
    if (content.imageDataUrl || content.base64 || content.rendererId === "pdf")
      return "preview" as const;
    if (!content.rendererId) return "code" as const;
    if (content.diff !== null) return "preview" as const;
    return viewMode;
  }, [content, viewMode]);
  const canToggle =
    content !== null &&
    content.rendererId !== null &&
    content.imageDataUrl === null &&
    content.base64 === null &&
    content.diff === null &&
    content.binaryMeta === null;
  const isPinned =
    activeResource !== null &&
    pinnedKey === (activeResource ? workspaceResourceKey(activeResource) : null);

  // §21 header facts: where this preview came from + file actions. Screenshots
  // live in app-data (reveal N/A); files/canvas live in the workspace.
  const resourcePath = activeResource && "path" in activeResource ? activeResource.path : null;
  const revealablePath =
    activeResource &&
    (activeResource.kind === "file" ||
      activeResource.kind === "canvas" ||
      activeResource.kind === "screenshot")
      ? resourcePath
      : null;
  const sourceLabel = activeResource
    ? t(`workspace.source.${activeResource.kind === "file" ? "files" : activeResource.kind}`)
    : null;
  const previewStatus = appPreviewStatus(devController.server, devController.starting);

  return (
    <div className="workspace-preview-tab">
      {activeResource && (
        <header className="workspace-resource-header">
          <div className="workspace-resource-nav">
            <Tip content={t("workspace.back")} side="bottom">
              <Button
                variant="ghost"
                size="icon-xs"
                className="disabled:opacity-35"
                onClick={goBack}
                disabled={!canGoBack}
                aria-label={t("workspace.back")}
              >
                <ChevronLeft size={14} aria-hidden="true" />
              </Button>
            </Tip>
            <Tip content={t("workspace.forward")} side="bottom">
              <Button
                variant="ghost"
                size="icon-xs"
                className="disabled:opacity-35"
                onClick={goForward}
                disabled={!canGoForward}
                aria-label={t("workspace.forward")}
              >
                <ChevronRight size={14} aria-hidden="true" />
              </Button>
            </Tip>
          </div>
          <span className="workspace-resource-title" title={workspaceResourceTitle(activeResource)}>
            {workspaceResourceTitle(activeResource)}
          </span>
          {sourceLabel && (
            <span className="workspace-resource-source shrink-0 rounded-full border border-border bg-surface-hover px-1.5 py-px text-[9.5px] font-medium tracking-wide text-muted">
              {sourceLabel}
            </span>
          )}
          <div className="workspace-resource-actions">
            {previewStatus === "ready" && devController.server?.url && (
              <Tip content={t("workspace.previewApp.openInBrowser")} side="bottom">
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className="text-success"
                  aria-label={t("workspace.previewApp.openInBrowser")}
                  onClick={() =>
                    void openUrlInPanelBrowser(devController.server?.url ?? "").catch(
                      () => undefined,
                    )
                  }
                >
                  <span
                    className="app-preview-dot inline-block size-2 rounded-full bg-success"
                    aria-hidden="true"
                  />
                </Button>
              </Tip>
            )}
            {resourcePath && (
              <Tip content={t("workspace.copyPath")} side="bottom">
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label={t("workspace.copyPath")}
                  onClick={() =>
                    void copyTextWithFeedback(
                      resolveWorkspacePath(resourcePath, root) ?? resourcePath,
                      {
                        successKey: "workspace.pathCopied",
                      },
                    )
                  }
                >
                  <Copy size={13} aria-hidden="true" />
                </Button>
              </Tip>
            )}
            {revealablePath && (
              <Tip content={t("workspace.revealInFinder")} side="bottom">
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label={t("workspace.revealInFinder")}
                  onClick={() => {
                    const absolute = resolveWorkspacePath(revealablePath, root) ?? revealablePath;
                    void revealInFileManager(absolute).catch(() => undefined);
                  }}
                >
                  <SquareArrowOutUpRight size={13} aria-hidden="true" />
                </Button>
              </Tip>
            )}
            {canToggle && (
              <Tabs
                value={mode}
                onValueChange={(value) => setViewMode(value as "code" | "preview")}
              >
                <TabsList className="workspace-mode-toggle" aria-label={t("preview.viewMode")}>
                  <TabsTab value="code" className={mode === "code" ? "active" : ""}>
                    {t("preview.codeTab")}
                  </TabsTab>
                  <TabsTab value="preview" className={mode === "preview" ? "active" : ""}>
                    {t("preview.previewTab")}
                  </TabsTab>
                </TabsList>
              </Tabs>
            )}
            <Tip content={isPinned ? t("workspace.unpin") : t("workspace.pin")} side="bottom">
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={togglePin}
                aria-label={isPinned ? t("workspace.unpin") : t("workspace.pin")}
                aria-pressed={isPinned}
              >
                {isPinned ? (
                  <PinOff size={14} aria-hidden="true" />
                ) : (
                  <Pin size={14} aria-hidden="true" />
                )}
              </Button>
            </Tip>
          </div>
        </header>
      )}
      <div className="workspace-preview-body">
        {activeResource?.kind === "canvas" ? (
          <Suspense fallback={<p className="preview-loading-text">{t("preview.loading")}</p>}>
            <CanvasView path={activeResource.path} title={activeResource.title} />
          </Suspense>
        ) : (
          state.phase === "loading" && (
            <div className="workspace-empty">
              <LoaderCircle size={20} className="spin" aria-hidden="true" />
              <p>{t("workspace.loading")}</p>
            </div>
          )
        )}
        {state.phase === "error" && <ResourceError message={state.message} />}
        {state.phase === "ready" &&
          (!activeResource ? (
            <ResourceEmpty controller={devController} />
          ) : content === null ? null : content.binaryMeta ? (
            <BinaryMetaCard meta={content.binaryMeta} />
          ) : content.imageDataUrl ? (
            <img
              className="workspace-image-preview"
              src={content.imageDataUrl}
              alt={workspaceResourceTitle(activeResource)}
            />
          ) : content.base64 && content.rendererId === "pdf" ? (
            <ArtifactPreview rendererId="pdf" source="" data={content.base64} />
          ) : content.diff !== null ? (
            content.diff === "" ? (
              <div className="workspace-empty">
                <FileQuestion size={20} aria-hidden="true" />
                <p>
                  {content.diffReason === "not-a-repo"
                    ? t("workspace.diffNoRepo")
                    : t("workspace.diffUnavailable")}
                </p>
              </div>
            ) : (
              <Suspense fallback={<p className="preview-loading-text">{t("preview.loading")}</p>}>
                <DiffPreview source={content.diff} />
              </Suspense>
            )
          ) : mode === "preview" && content.rendererId ? (
            <ArtifactPreview rendererId={content.rendererId} source={content.text ?? ""} />
          ) : content.text !== null ? (
            <CodeView text={content.text} language={content.language} />
          ) : (
            <ResourceEmpty controller={devController} />
          ))}
      </div>
    </div>
  );
}
