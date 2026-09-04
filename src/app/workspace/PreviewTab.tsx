import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ChevronLeft,
  ChevronRight,
  Copy,
  Eye,
  FileArchive,
  FileQuestion,
  FolderOpen,
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
  loadArtifact,
  readBinaryBase64,
  readTextFile,
  revealInFileManager,
  resolveChangeDiff,
  resolveWorkspacePath,
  statFile,
} from "../../features/workspace/workspace-services";
import { readScreenshotBase64 } from "../../features/workspace/browser-panel-service";
import { useActiveWorkspaceRoot } from "../../features/workspace/workspace-bridge";
import { useProjectStore } from "../../features/projects/project-store";
import { devServerFailureText, useDevServerUi, appPreviewStatus, openUrlInPanelBrowser } from "./use-dev-server-ui";
import { AppPreviewCard } from "./AppPreviewCard";
import {
  classifyFilePreview,
  fileExtension,
  imageMimeFor,
} from "./file-preview-classify";

function extensionLanguage(path: string): string {
  const extension = fileExtension(path);
  if (extension === "" || classifyFilePreview(path) !== "text") return "";
  const descriptor = previewRegistry.forExtension(extension);
  return descriptor?.id ?? extension;
}

function extensionRendererId(path: string): PreviewRendererId | null {
  return previewRegistry.forExtension(fileExtension(path))?.id ?? null;
}
import { normalizeFenceLanguage, previewRegistry } from "../../features/preview/preview-registry";
import { ArtifactPreview } from "../../features/preview/ArtifactPreview";
import { isHighlightable, useShikiHighlight } from "../../features/preview/use-shiki";
import { logger } from "../../core/logging/logger";
import type { WorkspaceResource } from "../../features/workspace/resource-model";
import type { PreviewRendererId } from "../../features/preview/types";
import type { ChangeEntry } from "../../features/workspace/changes-model";

const DiffPreview = lazy(() =>
  import("../../features/preview/renderers/DiffPreview").then((m) => ({ default: m.DiffPreview })),
);

// Canvas (React Flow) is a heavy surface: only this lazy chunk pulls
// @xyflow/react + its CSS, never the initial bundle (§83).
const CanvasView = lazy(() => import("../../features/canvas/CanvasView"));

type LoadingState = { phase: "loading" } | { phase: "ready" } | { phase: "error"; message: string };

interface BinaryMeta {
  path: string;
  size: number;
  modified: number | null;
  extension: string;
}

interface ResolvedContent {
  /** Text body (code fence language or file text). */
  text: string | null;
  language: string;
  /** Base64 for binary renderers (pdf). */
  base64: string | null;
  diff: string | null;
  diffReason?: string | undefined;
  rendererId: PreviewRendererId | null;
  /** Screenshot/image data URL rendered directly. */
  imageDataUrl: string | null;
  /** Metadata card for non-previewable binaries (§20: binary / zip 元信息). */
  binaryMeta: BinaryMeta | null;
}

/** Screenshot files live in app-data (outside the workspace root). */
async function readScreenshotDataUrl(path: string): Promise<string> {
  const base64 = await readScreenshotBase64(path);
  return `data:image/png;base64,${base64}`;
}

/**
 * Workspace image: read the actual file bytes from the project root. The
 * previous implementation reused the screenshot reader, which resolves
 * against the app-data browser-screenshots directory, so workspace images
 * never loaded.
 */
async function readWorkspaceImageDataUrl(path: string): Promise<string> {
  const base64 = await readBinaryBase64(path);
  return `data:${imageMimeFor(path)};base64,${base64}`;
}

function useResolvedResource(
  resource: WorkspaceResource | null,
  root: string | null,
  changes: readonly ChangeEntry[],
): { state: LoadingState; content: ResolvedContent | null } {
  const [state, setState] = useState<LoadingState>({ phase: "loading" });
  const [content, setContent] = useState<ResolvedContent | null>(null);

  useEffect(() => {
    if (!resource) {
      setState({ phase: "ready" });
      setContent(null);
      return;
    }
    let cancelled = false;
    setState({ phase: "loading" });
    setContent(null);
    const resolve = async () => {
      try {
        if (resource.kind === "canvas") {
          // The canvas view loads and parses its own document.
          return {
            text: null,
            language: "",
            base64: null,
            diff: null,
            rendererId: null,
            imageDataUrl: null,
            binaryMeta: null,
          } satisfies ResolvedContent;
        }
        if (resource.kind === "artifact") {
          const artifact = await loadArtifact(resource.artifactId);
          if (!artifact) throw new Error("artifact-unavailable");
          return {
            text: artifact.content,
            language: artifact.language,
            base64: null,
            diff: null,
            rendererId:
              previewRegistry.forLanguage(artifact.language)?.id ??
              previewRegistry.detect({ content: artifact.content, language: "", streaming: false })
                ?.id ??
              null,
            imageDataUrl: null,
            binaryMeta: null,
          } satisfies ResolvedContent;
        }
        if (resource.kind === "diff") {
          const change = changes.find(
            (entry) => resolveWorkspacePath(entry.path, root) === resource.path,
          ) ?? {
            path: resource.path,
            changeType: "modified" as const,
            toolName: "",
            runId: resource.runId ?? "",
            createdAt: 0,
          };
          const resolved = await resolveChangeDiff(change, root);
          return {
            text: null,
            language: "diff",
            base64: null,
            diff: resolved.diff,
            diffReason: resolved.reason,
            rendererId: "diff",
            imageDataUrl: null,
            binaryMeta: null,
          } satisfies ResolvedContent;
        }
        if (resource.kind === "screenshot") {
          return {
            text: null,
            language: "",
            base64: null,
            diff: null,
            rendererId: null,
            imageDataUrl: await readScreenshotDataUrl(resource.path),
            binaryMeta: null,
          } satisfies ResolvedContent;
        }
        if (resource.kind === "url") {
          return {
            text: null,
            language: "",
            base64: null,
            diff: null,
            rendererId: null,
            imageDataUrl: null,
            binaryMeta: null,
          } satisfies ResolvedContent;
        }
        // file
        const previewKind = classifyFilePreview(resource.path);
        if (previewKind === "image") {
          return {
            text: null,
            language: "",
            base64: null,
            diff: null,
            rendererId: null,
            imageDataUrl: await readWorkspaceImageDataUrl(resource.path),
            binaryMeta: null,
          } satisfies ResolvedContent;
        }
        if (previewKind === "pdf") {
          return {
            text: null,
            language: "pdf",
            base64: await readBinaryBase64(resource.path),
            diff: null,
            rendererId: "pdf",
            imageDataUrl: null,
            binaryMeta: null,
          } satisfies ResolvedContent;
        }
        if (previewKind === "binary-meta") {
          const stat = await statFile(resource.path);
          if (!stat.exists) throw new Error("binary-preview-unavailable");
          return {
            text: null,
            language: "",
            base64: null,
            diff: null,
            rendererId: null,
            imageDataUrl: null,
            binaryMeta: {
              path: resource.path,
              size: stat.size,
              modified: stat.modified ?? null,
              extension: fileExtension(resource.path),
            },
          } satisfies ResolvedContent;
        }
        const language = extensionLanguage(resource.path);
        const text = await readTextFile(resource.path);
        return {
          text,
          language,
          base64: null,
          diff: null,
          rendererId:
            previewRegistry.forLanguage(language)?.id ?? extensionRendererId(resource.path),
          imageDataUrl: null,
          binaryMeta: null,
        } satisfies ResolvedContent;
      } catch (error) {
        if (cancelled) return null;
        const message = error instanceof Error ? error.message : String(error);
        return {
          error: message,
        } as unknown as ResolvedContent & { error: string };
      }
    };
    void resolve().then((value) => {
      if (cancelled) return;
      if (value === null) return;
      const maybeError = value as ResolvedContent & { error?: string };
      if (typeof maybeError.error === "string") {
        logger.error("workspace", "panel.resource-resolve-failed", {
          kind: resource.kind,
          message: maybeError.error,
        });
        setState({ phase: "error", message: maybeError.error });
        setContent(null);
        return;
      }
      logger.info("workspace", "panel.resource-resolved", {
        kind: resource.kind,
        rendererId: value.rendererId ?? null,
        diffReason: value.diffReason ?? null,
        textLength: value.text?.length ?? 0,
      });
      logger.info("ui", "ui.preview.open", {
        actionId: crypto.randomUUID(),
        resourceId:
          "path" in resource
            ? resource.path
            : "url" in resource
              ? resource.url
              : String(resource.kind),
      });
      setContent(value);
      setState({ phase: "ready" });
    });
    return () => {
      cancelled = true;
    };
  }, [resource, root, changes]);

  return { state, content };
}

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
  const resourcePath =
    activeResource && "path" in activeResource ? activeResource.path : null;
  const revealablePath =
    activeResource &&
    (activeResource.kind === "file" || activeResource.kind === "canvas" || activeResource.kind === "screenshot")
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
                    void copyTextWithFeedback(resolveWorkspacePath(resourcePath, root) ?? resourcePath, {
                      successKey: "workspace.pathCopied",
                    })
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
