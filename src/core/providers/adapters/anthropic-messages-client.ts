import { z } from "zod";
import type { ProtocolAdapterId } from "../types";
import {
  ProviderErrorType,
  type ProtocolAdapter,
  type ProviderError,
  type ProviderStreamEvent,
} from "../stream-events";
import { asNumber, asRecord, asString, mapThrownError, responseError } from "./openai-chat-utils";

interface AnthropicConnectionConfig {
  providerId: string;
  baseUrl: string;
  apiKey: string;
}

interface SseEvent {
  event?: string;
  data: string;
}

const authSchema = z.object({
  baseUrl: z.string().url().optional(),
  apiKey: z.string().min(1),
});

function uuid(): string {
  return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function messagesEndpoint(baseUrl: string): string {
  const clean = baseUrl.replace(/\/+$/, "");
  if (clean.endsWith("/messages")) return clean;
  return clean.endsWith("/v1") ? `${clean}/messages` : `${clean}/v1/messages`;
}

function requestMessages(messages: unknown[]): { messages: unknown[]; system?: string } {
  const system: string[] = [];
  const conversation: unknown[] = [];
  for (const value of messages) {
    const message = asRecord(value);
    if (asString(message?.role) === "system") {
      const content = asString(message?.content);
      if (content) system.push(content);
    } else {
      conversation.push(value);
    }
  }
  return { messages: conversation, ...(system.length > 0 ? { system: system.join("\n\n") } : {}) };
}

async function* sseEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<SseEvent> {
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

function streamError(payload: Record<string, unknown> | undefined): ProviderError {
  const error = asRecord(payload?.error);
  const providerType = asString(error?.type);
  return {
    type:
      providerType === "authentication_error"
        ? ProviderErrorType.AUTH_FAILED
        : providerType === "rate_limit_error"
          ? ProviderErrorType.RATE_LIMITED
          : ProviderErrorType.PROVIDER_ERROR,
    message: asString(error?.message) ?? "Anthropic stream returned an error",
    retryable: providerType === "overloaded_error" || providerType === "rate_limit_error",
    ...(providerType ? { providerDetails: { type: providerType } } : {}),
  };
}

export class AnthropicMessagesClient implements ProtocolAdapter {
  private connection: AnthropicConnectionConfig;

  constructor(
    public readonly id: ProtocolAdapterId,
    defaultBaseUrl: string,
    initial?: Partial<AnthropicConnectionConfig>,
  ) {
    this.connection = {
      providerId: initial?.providerId ?? "anthropic",
      baseUrl: initial?.baseUrl ?? defaultBaseUrl,
      apiKey: initial?.apiKey ?? "",
    };
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
          type: ProviderErrorType.AUTH_FAILED,
          message: auth.error.issues[0]?.message ?? "Invalid provider configuration",
          retryable: false,
        },
      };
    }
    this.connection = {
      providerId: config.providerId,
      baseUrl: (auth.data.baseUrl ?? this.connection.baseUrl).replace(/\/+$/, ""),
      apiKey: auth.data.apiKey,
    };
    try {
      const response = await this.request({
        model: config.modelId,
        max_tokens: 1,
        messages: [{ role: "user", content: "Reply OK" }],
        stream: false,
      });
      return response.ok ? { ok: true } : { ok: false, error: await responseError(response) };
    } catch (error) {
      return { ok: false, error: mapThrownError(error) };
    }
  }

  async *stream(params: {
    modelId: string;
    messages: unknown[];
    tools?: unknown[];
    signal?: AbortSignal;
  }): AsyncIterable<ProviderStreamEvent> {
    let responseId = uuid();
    let finishReason = "stop";
    let started = false;
    try {
      const response = await this.request(
        {
          model: params.modelId,
          max_tokens: 4096,
          ...requestMessages(params.messages),
          stream: true,
        },
        params.signal,
      );
      if (!response.ok) {
        yield { type: "error", error: await responseError(response) };
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
      for await (const sse of sseEvents(response.body)) {
        let payload: unknown;
        try {
          payload = JSON.parse(sse.data) as unknown;
        } catch {
          yield {
            type: "error",
            error: {
              type: ProviderErrorType.PROTOCOL_INCOMPATIBLE,
              message: "Provider returned invalid SSE JSON",
              retryable: false,
            },
          };
          return;
        }
        const root = asRecord(payload);
        const eventType = sse.event ?? asString(root?.type);
        if (eventType === "message_start") {
          responseId = asString(asRecord(root?.message)?.id) ?? responseId;
        }
        if (!started && eventType !== "ping") {
          started = true;
          yield {
            type: "response-start",
            responseId,
            modelId: params.modelId,
            providerId: this.connection.providerId,
          };
        }
        if (eventType === "content_block_delta") {
          const delta = asRecord(root?.delta);
          const text = asString(delta?.type) === "text_delta" ? asString(delta?.text) : undefined;
          if (text) yield { type: "text-delta", text };
        } else if (eventType === "message_delta") {
          finishReason = asString(asRecord(root?.delta)?.stop_reason) ?? finishReason;
          const usage = asRecord(root?.usage);
          const outputTokens = asNumber(usage?.output_tokens);
          if (outputTokens !== undefined) yield { type: "usage", usage: { outputTokens } };
        } else if (eventType === "error") {
          yield { type: "error", error: streamError(root) };
          return;
        } else if (eventType === "message_stop") {
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

  private request(body: Record<string, unknown>, signal?: AbortSignal): Promise<Response> {
    return fetch(messagesEndpoint(this.connection.baseUrl), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.connection.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
      ...(signal ? { signal } : {}),
    });
  }
}
