import { ProviderErrorType, type ProviderError } from "../stream-events";
import { asRecord, asString, responseError } from "./openai-chat-utils";

export function geminiRequestMessages(messages: unknown[]): Record<string, unknown> {
  const system: string[] = [];
  const contents: Record<string, unknown>[] = [];
  for (const value of messages) {
    const message = asRecord(value);
    const role = asString(message?.role);
    const text = asString(message?.content);
    if (!text) continue;
    if (role === "system") system.push(text);
    else if (role === "user" || role === "assistant" || role === "model") {
      contents.push({ role: role === "user" ? "user" : "model", parts: [{ text }] });
    }
  }
  return {
    contents,
    ...(system.length > 0 ? { systemInstruction: { parts: [{ text: system.join("\n\n") }] } } : {}),
  };
}

export async function geminiResponseError(response: Response): Promise<ProviderError> {
  const error = await responseError(response);
  return response.status === 400
    ? { ...error, type: ProviderErrorType.PROVIDER_ERROR, retryable: false }
    : error;
}

export function uuid(): string {
  return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
