import { ProviderErrorType, type ProviderError } from "../stream-events";
import { asRecord, asString } from "./openai-chat-utils";

interface SseEvent {
  event?: string;
  data: string;
}

export function uuid(): string {
  return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function responsesEndpoint(baseUrl: string): string {
  const clean = baseUrl.replace(/\/+$/, "");
  if (clean.endsWith("/responses")) return clean;
  return clean.endsWith("/v1") ? `${clean}/responses` : `${clean}/v1/responses`;
}

export function responsesInput(messages: unknown[]): Record<string, unknown>[] {
  const input: Record<string, unknown>[] = [];
  for (const value of messages) {
    const message = asRecord(value);
    const role = asString(message?.role);
    const text = asString(message?.content);
    if (!text || (role !== "user" && role !== "assistant" && role !== "system")) continue;
    input.push({
      role,
      content: [{ type: role === "assistant" ? "output_text" : "input_text", text }],
    });
  }
  return input;
}

export async function* responseSseEvents(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<SseEvent> {
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
        } else if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
      }
      if (done) break;
    }
    if (data.length > 0) yield { ...(event ? { event } : {}), data: data.join("\n") };
  } finally {
    reader.releaseLock();
  }
}

export function responsesStreamError(payload: Record<string, unknown> | undefined): ProviderError {
  const response = asRecord(payload?.response);
  const error = asRecord(payload?.error) ?? asRecord(response?.error);
  const code = asString(error?.code) ?? asString(error?.type);
  return {
    type:
      code === "rate_limit_exceeded"
        ? ProviderErrorType.RATE_LIMITED
        : code === "invalid_api_key"
          ? ProviderErrorType.AUTH_FAILED
          : ProviderErrorType.PROVIDER_ERROR,
    message: asString(error?.message) ?? "OpenAI Responses stream returned an error",
    retryable: code === "rate_limit_exceeded" || code === "server_error",
    ...(code ? { providerDetails: { code } } : {}),
  };
}
