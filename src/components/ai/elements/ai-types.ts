/**
 * Minimal type shim for vendored AI Elements components
 * (source: vercel/ai-elements, Apache-2.0).
 *
 * AI Elements normally types props against the Vercel `ai` SDK's UI part
 * types. Evir drives these components from its own runtime records through
 * adapters, so only the type shapes are shimmed here — no `ai` runtime
 * dependency is introduced and Evir's domain state remains the single
 * source of truth.
 */

/** Vercel AI SDK v5 chat status. */
export type ChatStatus = "submitted" | "streaming" | "ready" | "error";

export type FileUIPart = {
  type: "file";
  mediaType?: string | undefined;
  filename?: string | undefined;
  url: string;
};

export type ToolUIPartState =
  | "input-streaming"
  | "input-available"
  | "output-available"
  | "output-error"
  | "approval-requested"
  | "approval-responded"
  | "output-denied";

export type ToolUIPart = {
  type: `tool-${string}`;
  toolCallId: string;
  toolName: string;
  state: ToolUIPartState;
  input: unknown;
  output?: unknown;
  errorText?: string | undefined;
};

export type DynamicToolUIPart = {
  type: "dynamic-tool";
  toolCallId: string;
  toolName: string;
  state: ToolUIPartState;
  input: unknown;
  output?: unknown;
  errorText?: string | undefined;
};

export type SourceDocumentUIPart = {
  type: "source-document";
  sourceId: string;
  title?: string | undefined;
};
