import { ProviderErrorType, type ProviderError } from "../stream-events";
import { asRecord, asString } from "./openai-chat-utils";

export { uuid } from "./openai-chat-utils";
export { sseEvents as responseSseEvents } from "./openai-chat-utils";

export function responsesEndpoint(baseUrl: string): string {
  const clean = baseUrl.replace(/\/+$/, "");
  if (clean.endsWith("/responses")) return clean;
  return clean.endsWith("/v1") ? `${clean}/responses` : `${clean}/v1/responses`;
}

export function responsesInput(messages: unknown[]): {
  input: Record<string, unknown>[];
  instructions?: string;
} {
  const input: Record<string, unknown>[] = [];
  const systemParts: string[] = [];
  for (const value of messages) {
    const message = asRecord(value);
    const role = asString(message?.role);
    const text = asString(message?.content);
    if (!text) continue;
    if (role === "system") {
      systemParts.push(text);
      continue;
    }
    if (role !== "user" && role !== "assistant") continue;
    input.push({
      role,
      content: [{ type: role === "assistant" ? "output_text" : "input_text", text }],
    });
  }
  return {
    input,
    ...(systemParts.length > 0 ? { instructions: systemParts.join("\n\n") } : {}),
  };
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
