import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ChevronLeft,
  ChevronRight,
  Eye,
  FileQuestion,
  LoaderCircle,
  MonitorPlay,
  Pin,
  PinOff,
  Play,
  Square,
} from "lucide-react";
import { Button, Tabs, TabsList, TabsTab, Tip } from "../../components/ui";
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
  resolveChangeDiff,
  resolveWorkspacePath,
} from "../../features/workspace/workspace-services";
import { readScreenshotBase64 } from "../../features/workspace/browser-panel-service";
import { useActiveWorkspaceRoot } from "../../features/workspace/workspace-bridge";
import { useProjectStore } from "../../features/projects/project-store";
import { useConfirmationDialog } from "../useConfirmationDialog";
import { devServerFailureText, useDevServerUi } from "./use-dev-server-ui";
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
}

const BINARY_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "pdf", "ico", "bmp"]);

function fileExtension(path: string): string {
  const name = path.toLowerCase().replace(/\\/g, "/").split("/").pop() ?? "";
  const dot = name.lastIndexOf(".");
  return dot === -1 ? "" : name.slice(dot + 1);
}

function extensionLanguage(path: string): string {
  const extension = fileExtension(path);
  if (BINARY_EXTENSIONS.has(extension)) return "";
  const descriptor = previewRegistry.forExtension(extension);
  return descriptor?.id ?? extension;
}

function extensionRendererId(path: string): PreviewRendererId | null {
  return previewRegistry.forExtension(fileExtension(path))?.id ?? null;
}

/** Screenshot files live in app-data (outside the workspace root). */
async function readScreenshotDataUrl(path: string): Promise<string> {
  const base64 = await readScreenshotBase64(path);
  return `data:image/png;base64,${base64}`;
}

const IMAGE_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  ico: "image/x-icon",
  bmp: "image/bmp",
};

/**
 * Workspace image: read the actual file bytes from the project root. The
 * previous implementation reused the screenshot reader, which resolves
 * against the app-data browser-screenshots directory, so workspace images
 * never loaded.
 */
async function readWorkspaceImageDataUrl(path: string): Promise<string> {
  const base64 = await readBinaryBase64(path);
  const mime = IMAGE_MIME[fileExtension(path)] ?? "application/octet-stream";
  return `data:${mime};base64,${base64}`;
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
          } satisfies ResolvedContent;
        }
        // file
        const language = extensionLanguage(resource.path);
        if (language === "") {
          const name = resource.path.toLowerCase();
          if (name.endsWith(".pdf")) {
            return {
              text: null,
              language: "pdf",
              base64: await readBinaryBase64(resource.path),
              diff: null,
              rendererId: "pdf",
              imageDataUrl: null,
            } satisfies ResolvedContent;
          }
          return {
            text: null,
            language: "",
            base64: null,
            diff: null,
            rendererId: null,
            // Workspace file: read the real bytes from the project root. The
            // screenshot reader resolves against app-data and never matches here.
            imageDataUrl: await readWorkspaceImageDataUrl(resource.path).catch(() => {
              throw new Error("binary-preview-unavailable");
            }),
          } satisfies ResolvedContent;
        }
        const text = await readTextFile(resource.path);
        return {
          text,
          language,
          base64: null,
          diff: null,
          rendererId:
            previewRegistry.forLanguage(language)?.id ?? extensionRendererId(resource.path),
          imageDataUrl: null,
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

function ResourceEmpty() {
  const { t } = useTranslation();
  const root = useActiveWorkspaceRoot();
  const projects = useProjectStore((state) => state.projects);
  const currentProjectId = useProjectStore((state) => state.currentProjectId);
  const project = projects.find(({ id }) => id === currentProjectId);
  const {
    requestConfirmation: requestDevServerConfirmation,
    confirmationDialog: devServerConfirmation,
  } = useConfirmationDialog();

  const controller = useDevServerUi();
  const failure = devServerFailureText(controller, t("workspace.devServer.crashedHint"));
  const beginStart = (retry: boolean) => {
    logger.info("ui", retry ? "ui.app-preview.retry" : "ui.app-preview.start", {
      actionId: crypto.randomUUID(),
      projectId: project?.id,
    });
    if (!project) return;
    if (project.permissionProfile === "ask") {
      requestDevServerConfirmation(
        {
          title: t("workspace.previewApp.confirmTitle"),
          description: t("workspace.previewApp.confirmDescription"),
          confirmLabel: t("workspace.previewApp.start"),
          tone: "warning",
        },
        () => void controller.start(),
      );
      return;
    }
    void controller.start();
  };
  // Full §17 failure payload: command, exit code, and the process output tail.
  const crashed = controller.server?.status === "crashed";
  const failureCommand = controller.server
    ? `${controller.server.program} ${controller.server.args.join(" ")}`
    : null;
  const failureExitCode = controller.server?.exitCode ?? null;
  const failureLogs = crashed ? (controller.server?.lastOutput ?? []) : [];

  return (
    <div className="workspace-preview-empty">
      <section className="workspace-preview-empty-block">
        <Eye size={20} aria-hidden="true" />
        <h3>{t("workspace.previewFileTitle")}</h3>
        <p>{t("workspace.previewEmpty")}</p>
      </section>
      {root && (
        <section className="workspace-preview-empty-block app-preview-card">
          <MonitorPlay size={20} aria-hidden="true" />
          <div className="app-preview-copy">
            <h3>{t("workspace.previewApp.title")}</h3>
            {controller.active ? (
              <p className="app-preview-state">
                {controller.starting
                  ? t("workspace.previewApp.starting")
                  : controller.server?.url
                    ? controller.server.url
                    : t("workspace.previewApp.running")}
              </p>
            ) : controller.plan ? (
              <p className="app-preview-state">
                {t("workspace.previewApp.detected", {
                  script: `${controller.plan.program} ${controller.plan.args.join(" ")}`,
                })}
              </p>
            ) : (
              <p className="app-preview-state">{t("workspace.previewApp.noScript")}</p>
            )}
            {failure && <p className="app-preview-failure">{failure}</p>}
            {crashed && failureCommand && (
              <div className="app-preview-failure-detail">
                <p>
                  {t("workspace.devServer.command")}: <code>{failureCommand}</code>
                </p>
                {failureExitCode !== null && (
                  <p>
                    {t("workspace.devServer.exitCode")}: <code>{failureExitCode}</code>
                  </p>
                )}
                {failureLogs.length > 0 && (
                  <details>
                    <summary>{t("workspace.devServer.viewLogs")}</summary>
                    <pre>{failureLogs.slice(-10).join("\n")}</pre>
                  </details>
                )}
              </div>
            )}
          </div>
          <div className="app-preview-actions">
            {controller.active ? (
              <Button variant="secondary" size="lg" onClick={() => void controller.stop()}>
                <Square size={12} aria-hidden="true" />
                {t("workspace.devServer.stop")}
              </Button>
            ) : (
              controller.plan && (
                <Button
                  variant="primary"
                  size="lg"
                  disabled={controller.starting}
                  onClick={() => beginStart(false)}
                >
                  {controller.starting ? (
                    <LoaderCircle size={13} className="spin" aria-hidden="true" />
                  ) : (
                    <Play size={13} aria-hidden="true" />
                  )}
                  {controller.starting
                    ? t("workspace.previewApp.starting")
                    : t("workspace.previewApp.start")}
                </Button>
              )
            )}
            {controller.server?.status === "crashed" && (
              <Button
                variant="secondary"
                size="lg"
                disabled={controller.starting}
                onClick={() => beginStart(true)}
              >
                {t("workspace.devServer.retry")}
              </Button>
            )}
          </div>
        </section>
      )}
      {devServerConfirmation}
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
 * back/forward history, pin, and the Code/Preview mode toggle.
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
  const root = useActiveWorkspaceRoot();
  const { state, content } = useResolvedResource(activeResource, root, changes);

  const mode = useMemo(() => {
    if (!content) return "code" as const;
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
    content.diff === null;
  const isPinned =
    activeResource !== null &&
    pinnedKey === (activeResource ? workspaceResourceKey(activeResource) : null);

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
          <div className="workspace-resource-actions">
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
            <ResourceEmpty />
          ) : content === null ? null : content.imageDataUrl ? (
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
            <ResourceEmpty />
          ))}
      </div>
    </div>
  );
}
