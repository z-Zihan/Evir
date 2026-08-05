import { ProviderErrorType, type ProviderError } from "../stream-events";

export function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function asNumber(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

export function chatEndpoint(baseUrl: string): string {
  const clean = baseUrl.replace(/\/+$/, "");
  return clean.endsWith("/chat/completions") ? clean : `${clean}/chat/completions`;
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

export function mapHttpError(status: number, message: string): ProviderError {
  const messageType = classifyMessage(message);
  if (messageType) return { type: messageType, message, retryable: false };
  if (status === 401 || status === 403) {
    return { type: ProviderErrorType.AUTH_FAILED, message, retryable: false };
  }
  if (status === 404) {
    return { type: ProviderErrorType.MODEL_NOT_FOUND, message, retryable: false };
  }
  if (status === 429) {
    return { type: ProviderErrorType.RATE_LIMITED, message, retryable: true };
  }
  return {
    type:
      status >= 500 ? ProviderErrorType.PROVIDER_ERROR : ProviderErrorType.PROTOCOL_INCOMPATIBLE,
    message,
    retryable: status >= 500,
    providerDetails: { status },
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
  let payload: unknown;
  try {
    payload = JSON.parse(await response.text()) as unknown;
  } catch {
    payload = undefined;
  }
  const root = asRecord(payload);
  const nested = asRecord(root?.error);
  const message =
    asString(nested?.message) ??
    asString(root?.message) ??
    `Provider returned HTTP ${response.status}`;
  return mapHttpError(response.status, message);
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
