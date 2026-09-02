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
            imageDataUrl: await readScreenshotDataUrl(resource.path).catch(() => {
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
  const beginStart = () => {
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
          </div>
          <div className="app-preview-actions">
            {controller.active ? (
              <button
                type="button"
                className="secondary-button"
                onClick={() => void controller.stop()}
              >
                <Square size={12} aria-hidden="true" />
                {t("workspace.devServer.stop")}
              </button>
            ) : (
              controller.plan && (
                <button
                  type="button"
                  className="primary-button"
                  disabled={controller.starting}
                  onClick={beginStart}
                >
                  {controller.starting ? (
                    <LoaderCircle size={13} className="spin" aria-hidden="true" />
                  ) : (
                    <Play size={13} aria-hidden="true" />
                  )}
                  {controller.starting
                    ? t("workspace.previewApp.starting")
                    : t("workspace.previewApp.start")}
                </button>
              )
            )}
            {controller.server?.status === "crashed" && (
              <button
                type="button"
                className="secondary-button"
                disabled={controller.starting}
                onClick={beginStart}
              >
                {t("workspace.devServer.retry")}
              </button>
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
            <button
              type="button"
              className="workspace-icon-button"
              onClick={goBack}
              disabled={!canGoBack}
              aria-label={t("workspace.back")}
              data-tip={t("workspace.back")}
            >
              <ChevronLeft size={14} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="workspace-icon-button"
              onClick={goForward}
              disabled={!canGoForward}
              aria-label={t("workspace.forward")}
              data-tip={t("workspace.forward")}
            >
              <ChevronRight size={14} aria-hidden="true" />
            </button>
          </div>
          <span className="workspace-resource-title" title={workspaceResourceTitle(activeResource)}>
            {workspaceResourceTitle(activeResource)}
          </span>
          <div className="workspace-resource-actions">
            {canToggle && (
              <div
                className="workspace-mode-toggle"
                role="group"
                aria-label={t("preview.viewMode")}
              >
                <button
                  type="button"
                  className={mode === "code" ? "active" : ""}
                  aria-pressed={mode === "code"}
                  onClick={() => setViewMode("code")}
                >
                  {t("preview.codeTab")}
                </button>
                <button
                  type="button"
                  className={mode === "preview" ? "active" : ""}
                  aria-pressed={mode === "preview"}
                  onClick={() => setViewMode("preview")}
                >
                  {t("preview.previewTab")}
                </button>
              </div>
            )}
            <button
              type="button"
              className="workspace-icon-button"
              onClick={togglePin}
              aria-label={isPinned ? t("workspace.unpin") : t("workspace.pin")}
              aria-pressed={isPinned}
              data-tip={isPinned ? t("workspace.unpin") : t("workspace.pin")}
            >
              {isPinned ? (
                <PinOff size={14} aria-hidden="true" />
              ) : (
                <Pin size={14} aria-hidden="true" />
              )}
            </button>
          </div>
        </header>
      )}
      <div className="workspace-preview-body">
        {state.phase === "loading" && (
          <div className="workspace-empty">
            <LoaderCircle size={20} className="spin" aria-hidden="true" />
            <p>{t("workspace.loading")}</p>
          </div>
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
