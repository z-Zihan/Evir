import { z } from "zod";

/**
 * Workspace Resource Model — the single "what is the user working on" concept
 * shared by chat artifacts, project files, diffs, URLs and browser
 * screenshots. Everything that opens in the workspace panel routes through
 * one of these variants; the panel never builds per-surface open logic.
 */

export interface FileResource {
  kind: "file";
  /** Absolute path inside the current workspace root. */
  path: string;
  mimeType?: string | undefined;
}

export interface DiffResource {
  kind: "diff";
  /** Absolute path of the changed file. */
  path: string;
  runId?: string | undefined;
}

export interface ArtifactResource {
  kind: "artifact";
  /** Stable identity for chat-fence artifacts (call site decides, e.g. hash). */
  artifactId: string;
  language: string;
  title?: string | undefined;
  mimeType?: string | undefined;
}

export interface UrlResource {
  kind: "url";
  uri: string;
}

export interface ScreenshotResource {
  kind: "screenshot";
  /** Absolute path under the app-data browser-screenshots directory. */
  path: string;
  label?: string | undefined;
}

export type WorkspaceResource =
  FileResource | DiffResource | ArtifactResource | UrlResource | ScreenshotResource;

export const fileResourceSchema = z.object({
  kind: z.literal("file"),
  path: z.string().min(1),
  mimeType: z.string().optional(),
});

export const diffResourceSchema = z.object({
  kind: z.literal("diff"),
  path: z.string().min(1),
  runId: z.string().optional(),
});

export const artifactResourceSchema = z.object({
  kind: z.literal("artifact"),
  artifactId: z.string().min(1),
  language: z.string(),
  title: z.string().optional(),
  mimeType: z.string().optional(),
});

export const urlResourceSchema = z.object({
  kind: z.literal("url"),
  uri: z.string().min(1),
});

export const screenshotResourceSchema = z.object({
  kind: z.literal("screenshot"),
  path: z.string().min(1),
  label: z.string().optional(),
});

export const workspaceResourceSchema = z.discriminatedUnion("kind", [
  fileResourceSchema,
  diffResourceSchema,
  artifactResourceSchema,
  urlResourceSchema,
  screenshotResourceSchema,
]);

/** Validate untrusted (tool-derived or persisted) resource payloads. */
export function parseWorkspaceResource(value: unknown): WorkspaceResource | null {
  const parsed = workspaceResourceSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** Stable identity for history dedupe and pinning. */
export function workspaceResourceKey(resource: WorkspaceResource): string {
  switch (resource.kind) {
    case "file":
      return `file:${resource.path}`;
    case "diff":
      return `diff:${resource.path}`;
    case "artifact":
      return `artifact:${resource.artifactId}`;
    case "url":
      return `url:${resource.uri}`;
    case "screenshot":
      return `screenshot:${resource.path}`;
  }
}

/** Short display name shown in resource headers and context chips. */
export function workspaceResourceTitle(resource: WorkspaceResource): string {
  switch (resource.kind) {
    case "file":
    case "diff": {
      const segments = resource.path.split(/[\\/]/).filter(Boolean);
      return segments.slice(-2).join("/") || resource.path;
    }
    case "artifact":
      return resource.title ?? resource.artifactId.slice(0, 24);
    case "url":
      return resource.uri.replace(/^https?:\/\//, "").slice(0, 60);
    case "screenshot":
      return resource.label ?? "screenshot.png";
  }
}
