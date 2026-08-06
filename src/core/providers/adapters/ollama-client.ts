import { z } from "zod";
import type { ProtocolAdapterId } from "../types";
import {
  ProviderErrorType,
  type ProtocolAdapter,
  type ProviderError,
  type ProviderStreamEvent,
} from "../stream-events";
import {
  asNumber as number,
  asRecord as record,
  asString as string,
  mapThrownError,
} from "./openai-chat-utils";

const DEFAULT_BASE_URL = "http://localhost:11434";

export interface OllamaConnectionConfig {
  providerId: string;
  baseUrl: string;
}

const authSchema = z.object({
  baseUrl: z.string().url().optional(),
});

function uuid(): string {
  return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

async function* ndjsonLines(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
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
        const trimmed = line.trim();
        if (trimmed) yield trimmed;
      }
      if (done) break;
    }
    if (buffer.trim()) yield buffer.trim();
  } finally {
    reader.releaseLock();
  }
}

async function ollamaResponseError(response: Response): Promise<ProviderError> {
  let payload: unknown;
  try {
    payload = JSON.parse(await response.text()) as unknown;
  } catch {
    payload = undefined;
  }
  const message = string(record(payload)?.error) ?? `Provider returned HTTP ${response.status}`;
  if (response.status === 404) {
    return { type: ProviderErrorType.MODEL_NOT_FOUND, message, retryable: false };
  }
  if (response.status === 429) {
    return { type: ProviderErrorType.RATE_LIMITED, message, retryable: true };
  }
  return {
    type:
      response.status >= 500
        ? ProviderErrorType.PROVIDER_ERROR
        : ProviderErrorType.PROTOCOL_INCOMPATIBLE,
    message,
    retryable: response.status >= 500,
    providerDetails: { status: response.status },
  };
}

export class OllamaClient implements ProtocolAdapter {
  public readonly id: ProtocolAdapterId;
  private connection: OllamaConnectionConfig;

  constructor(initial?: Partial<OllamaConnectionConfig>) {
    this.id = "ollama-native";
    this.connection = {
      providerId: initial?.providerId ?? "ollama",
      baseUrl: (initial?.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, ""),
    };
  }

  configure(config: OllamaConnectionConfig): void {
    this.connection = { ...config, baseUrl: config.baseUrl.replace(/\/+$/, "") };
  }

  async listModels(config: { authConfig: Record<string, unknown> }): Promise<string[]> {
    const auth = authSchema.parse(config.authConfig);
    const baseUrl = (auth.baseUrl ?? this.connection.baseUrl).replace(/\/+$/, "");
    const response = await fetch(`${baseUrl}/api/tags`);
    if (!response.ok) {
      const error = await ollamaResponseError(response);
      throw new Error(error.message);
    }
    const payload = record(await response.json());
    const models = Array.isArray(payload?.models) ? payload.models : [];
    return models
      .map((entry) => string(record(entry)?.name))
      .filter((name): name is string => Boolean(name));
  }

  async testConnection(config: {
    providerId: string;
    modelId: string;
    authConfig: Record<string, unknown>;
  }): Promise<{ ok: boolean; error?: ProviderError }> {
    const auth = authSchema.safeParse(config.authConfig);
    if (!auth.success) {
      return {
        ok: false,
        error: {
          type: ProviderErrorType.PROTOCOL_INCOMPATIBLE,
          message: auth.error.issues[0]?.message ?? "Invalid provider configuration",
          retryable: false,
        },
      };
    }
    this.configure({
      providerId: config.providerId,
      baseUrl: auth.data.baseUrl ?? this.connection.baseUrl,
    });
    try {
      const response = await fetch(`${this.connection.baseUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: config.modelId,
          messages: [{ role: "user", content: "Hi" }],
          stream: false,
        }),
      });
      return response.ok ? { ok: true } : { ok: false, error: await ollamaResponseError(response) };
    } catch (error) {
      return { ok: false, error: mapThrownError(error) };
    }
  }

  private async modelSupportsTools(modelId: string): Promise<boolean> {
    try {
      const response = await fetch(`${this.connection.baseUrl}/api/show`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: modelId }),
      });
      if (!response.ok) return false;
      const payload = record(await response.json());
      const capabilities = Array.isArray(payload?.capabilities) ? payload.capabilities : [];
      return capabilities.includes("tools");
    } catch {
      return false;
    }
  }

  async *stream(params: {
    modelId: string;
    messages: unknown[];
    tools?: unknown[];
    signal?: AbortSignal;
  }): AsyncIterable<ProviderStreamEvent> {
    const responseId = uuid();
    let finishReason = "stop";
    try {
      const includeTools =
        !!params.tools?.length && (await this.modelSupportsTools(params.modelId));
      const response = await fetch(`${this.connection.baseUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: params.modelId,
          messages: params.messages,
          ...(includeTools ? { tools: params.tools } : {}),
          stream: true,
        }),
        ...(params.signal ? { signal: params.signal } : {}),
      });
      if (!response.ok) {
        yield { type: "error", error: await ollamaResponseError(response) };
        return;
      }
      if (!response.body) {
        yield {
          type: "error",
          error: {
            type: ProviderErrorType.NETWORK_ERROR,
            message: "Provider returned no response stream",
            retryable: true,
          },
        };
        return;
      }
      yield {
        type: "response-start",
        responseId,
        modelId: params.modelId,
        providerId: this.connection.providerId,
      };
      let nextToolCallIndex = 0;
      for await (const line of ndjsonLines(response.body)) {
        let payload: unknown;
        try {
          payload = JSON.parse(line) as unknown;
        } catch {
          yield {
            type: "error",
            error: {
              type: ProviderErrorType.PROTOCOL_INCOMPATIBLE,
              message: "Provider returned invalid NDJSON",
              retryable: false,
            },
          };
          return;
        }
        const root = record(payload);
        const message = record(root?.message);
        const content = string(message?.content);
        if (content) yield { type: "text-delta", text: content };
        const toolCalls = Array.isArray(message?.tool_calls) ? message.tool_calls : [];
        for (const rawCall of toolCalls) {
          const call = record(rawCall);
          const fn = record(call?.function);
          const toolCallId = `tool-${nextToolCallIndex++}`;
          yield { type: "tool-call-start", toolCallId, toolName: string(fn?.name) ?? "unknown" };
          yield {
            type: "tool-call-arguments-delta",
            toolCallId,
            argumentsDelta: JSON.stringify(fn?.arguments ?? {}),
          };
          yield { type: "tool-call-end", toolCallId };
        }
        if (root?.done === true) {
          finishReason = string(root.done_reason) ?? finishReason;
          const promptEvalCount = number(root.prompt_eval_count);
          const evalCount = number(root.eval_count);
          if (promptEvalCount !== undefined || evalCount !== undefined) {
            yield {
              type: "usage",
              usage: {
                ...(promptEvalCount !== undefined ? { inputTokens: promptEvalCount } : {}),
                ...(evalCount !== undefined ? { outputTokens: evalCount } : {}),
                ...(promptEvalCount !== undefined && evalCount !== undefined
                  ? { totalTokens: promptEvalCount + evalCount }
                  : {}),
              },
            };
          }
          yield { type: "response-complete", responseId, finishReason };
          return;
        }
      }
      yield {
        type: "error",
        error: {
          type: ProviderErrorType.NETWORK_ERROR,
          message: "Provider stream ended before completion",
          retryable: true,
        },
      };
    } catch (error) {
      yield { type: "error", error: mapThrownError(error, params.signal) };
    }
  }
}
