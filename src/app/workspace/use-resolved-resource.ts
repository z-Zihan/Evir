import { useEffect, useState } from "react";
import {
  loadArtifact,
  readBinaryBase64,
  readTextFile,
  resolveChangeDiff,
  resolveWorkspacePath,
  statFile,
} from "../../features/workspace/workspace-services";
import { readScreenshotBase64 } from "../../features/workspace/browser-panel-service";
import { previewRegistry } from "../../features/preview/preview-registry";
import { logger } from "../../core/logging/logger";
import { classifyFilePreview, fileExtension, imageMimeFor } from "./file-preview-classify";
import type { WorkspaceResource } from "../../features/workspace/resource-model";
import type { PreviewRendererId } from "../../features/preview/types";
import type { ChangeEntry } from "../../features/workspace/changes-model";

/**
 * Resource resolution for the workspace preview pane (§13/§20): one async
 * pipeline that turns the active WorkspaceResource into renderable content —
 * text + renderer id, image data URLs, PDF base64, diffs, screenshots, canvas
 * passthrough, or binary metadata — with honest loading/error states.
 */

export function extensionLanguage(path: string): string {
  const extension = fileExtension(path);
  if (extension === "" || classifyFilePreview(path) !== "text") return "";
  const descriptor = previewRegistry.forExtension(extension);
  return descriptor?.id ?? extension;
}

export function extensionRendererId(path: string): PreviewRendererId | null {
  return previewRegistry.forExtension(fileExtension(path))?.id ?? null;
}

export type LoadingState =
  { phase: "loading" } | { phase: "ready" } | { phase: "error"; message: string };

export interface BinaryMeta {
  path: string;
  size: number;
  modified: number | null;
  extension: string;
}

export interface ResolvedContent {
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

export function useResolvedResource(
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
