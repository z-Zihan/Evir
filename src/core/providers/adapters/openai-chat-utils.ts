import { ProviderErrorType, type ProviderError } from "../stream-events";

export function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** Correlation id for tool calls and SSE events across all protocol adapters. */
export function uuid(): string {
  return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function asNumber(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

export function chatEndpoint(baseUrl: string): string {
  const clean = baseUrl.replace(/\/+$/, "");
  if (clean.endsWith("/chat/completions")) return clean;
  return `${clean}/chat/completions`;
}

function classifyMessage(message: string): ProviderErrorType | undefined {
  const normalized = message.toLowerCase();
  if (normalized.includes("context") && normalized.includes("length")) {
    return ProviderErrorType.CONTEXT_OVERFLOW;
  }
  if (
    normalized.includes("insufficient") &&
    (normalized.includes("quota") || normalized.includes("balance"))
  ) {
    return ProviderErrorType.INSUFFICIENT_BALANCE;
  }
  if (normalized.includes("tool") && normalized.includes("support")) {
    return ProviderErrorType.TOOL_CALL_UNSUPPORTED;
  }
  return undefined;
}

export function mapHttpError(
  status: number,
  message: string,
  providerDetails: Record<string, unknown> = {},
): ProviderError {
  const messageType = classifyMessage(message);
  const details = { status, ...providerDetails };
  if (messageType) {
    return { type: messageType, message, retryable: false, providerDetails: details };
  }
  if (status === 401 || status === 403) {
    return {
      type: ProviderErrorType.AUTH_FAILED,
      message,
      retryable: false,
      providerDetails: details,
    };
  }
  if (status === 404) {
    return {
      type: ProviderErrorType.MODEL_NOT_FOUND,
      message,
      retryable: false,
      providerDetails: details,
    };
  }
  if (status === 429) {
    return {
      type: ProviderErrorType.RATE_LIMITED,
      message,
      retryable: true,
      providerDetails: details,
    };
  }
  return {
    type:
      status >= 500 ? ProviderErrorType.PROVIDER_ERROR : ProviderErrorType.PROTOCOL_INCOMPATIBLE,
    message,
    retryable: status >= 500,
    providerDetails: details,
  };
}

export function mapThrownError(error: unknown, signal?: AbortSignal): ProviderError {
  if (signal?.aborted || (error instanceof DOMException && error.name === "AbortError")) {
    return { type: ProviderErrorType.CANCELLED, message: "Request cancelled", retryable: false };
  }
  if (error instanceof TypeError) {
    return { type: ProviderErrorType.CORS_BLOCKED, message: error.message, retryable: false };
  }
  return {
    type: ProviderErrorType.NETWORK_ERROR,
    message: error instanceof Error ? error.message : "Network request failed",
    retryable: true,
  };
}

export async function responseError(response: Response): Promise<ProviderError> {
  const responseText = await response.text();
  let payload: unknown;
  try {
    payload = JSON.parse(responseText) as unknown;
  } catch {
    payload = undefined;
  }
  const root = asRecord(payload);
  const nested = asRecord(root?.error);
  const message =
    asString(nested?.message) ??
    asString(root?.message) ??
    `Provider returned HTTP ${response.status}`;
  const code = asString(nested?.code) ?? asString(root?.code);
  const errorType = asString(nested?.type) ?? asString(root?.type);
  const param = asString(nested?.param) ?? asString(root?.param);
  const requestId =
    response.headers.get("x-request-id") ?? response.headers.get("x-requestid") ?? undefined;
  return mapHttpError(response.status, message, {
    ...(code ? { code } : {}),
    ...(errorType ? { errorType } : {}),
    ...(param ? { param } : {}),
    ...(requestId ? { requestId } : {}),
    responseFormat: payload === undefined ? "non-json" : "json",
  });
}

export async function* dataLines(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (line.startsWith("data:")) yield line.slice(5).trimStart();
      }
      if (done) break;
    }
    if (buffer.startsWith("data:")) yield buffer.slice(5).trimStart();
  } finally {
    reader.releaseLock();
  }
}

export interface SseEvent {
  event?: string;
  data: string;
}

/**
 * Shared SSE parser for `text/event-stream` bodies (Anthropic and OpenAI
 * Responses both use named events + JSON data payloads). Line-oriented: an
 * empty line dispatches the accumulated event, with a final flush at EOF.
 */
export async function* sseEvents(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<SseEvent, void, undefined> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let event: string | undefined;
  let data: string[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";
      if (done && buffer) lines.push(buffer);
      for (const line of lines) {
        if (line === "") {
          if (data.length > 0) yield { ...(event ? { event } : {}), data: data.join("\n") };
          event = undefined;
          data = [];
        } else if (line.startsWith("event:")) {
          event = line.slice(6).trim();
        } else if (line.startsWith("data:")) {
          data.push(line.slice(5).trimStart());
        }
      }
      if (done) break;
    }
    if (data.length > 0) yield { ...(event ? { event } : {}), data: data.join("\n") };
  } finally {
    reader.releaseLock();
  }
}
