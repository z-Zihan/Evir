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
  chatEndpoint,
  dataLines,
  mapThrownError,
  responseError,
} from "./openai-chat-utils";

export interface OpenAIConnectionConfig {
  providerId: string;
  baseUrl: string;
  apiKey: string;
}

const authSchema = z.object({
  baseUrl: z.string().url().optional(),
  apiKey: z.string().min(1),
});
const modelsResponseSchema = z.object({
  data: z.array(z.object({ id: z.string() })),
});

function uuid(): string {
  return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export class OpenAIChatClient implements ProtocolAdapter {
  private connection: OpenAIConnectionConfig;

  constructor(
    public readonly id: ProtocolAdapterId,
    defaultBaseUrl: string,
    initial?: Partial<OpenAIConnectionConfig>,
  ) {
    this.connection = {
      providerId: initial?.providerId ?? "openai",
      baseUrl: initial?.baseUrl ?? defaultBaseUrl,
      apiKey: initial?.apiKey ?? "",
    };
  }

  configure(config: OpenAIConnectionConfig): void {
    this.connection = { ...config, baseUrl: config.baseUrl.replace(/\/+$/, "") };
  }

  async listModels(config: { authConfig: Record<string, unknown> }): Promise<string[]> {
    const auth = authSchema.parse(config.authConfig);
    const baseUrl = (auth.baseUrl ?? this.connection.baseUrl).replace(/\/+$/, "");
    const response = await fetch(`${baseUrl}/models`, {
      headers: { Authorization: `Bearer ${auth.apiKey}` },
    });
    if (!response.ok) {
      const error = await responseError(response);
      throw new Error(error.message);
    }
    return modelsResponseSchema.parse(await response.json()).data.map(({ id }) => id);
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
    this.configure({
      providerId: config.providerId,
      baseUrl: auth.data.baseUrl ?? this.connection.baseUrl,
      apiKey: auth.data.apiKey,
    });
    try {
      const response = await this.request({
        model: config.modelId,
        messages: [{ role: "user", content: "Hi" }],
        max_tokens: 5,
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
    let responseId: string = uuid();
    let finishReason = "stop";
    let hasFinished = false;
    const openToolCalls = new Set<string>();
    const toolCallIds = new Map<number, string>();
    try {
      const response = await this.request(
        {
          model: params.modelId,
          messages: params.messages,
          ...(params.tools ? { tools: params.tools } : {}),
          stream: true,
          stream_options: { include_usage: true },
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
      yield {
        type: "response-start",
        responseId,
        modelId: params.modelId,
        providerId: this.connection.providerId,
      };
      for await (const data of dataLines(response.body)) {
        if (data === "[DONE]") {
          for (const toolCallId of openToolCalls) yield { type: "tool-call-end", toolCallId };
          yield { type: "response-complete", responseId, finishReason };
          return;
        }
        let payload: unknown;
        try {
          payload = JSON.parse(data) as unknown;
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
        const root = record(payload);
        responseId = string(root?.id) ?? responseId;
        const choice = Array.isArray(root?.choices) ? record(root.choices[0]) : undefined;
        const delta = record(choice?.delta);
        const content = string(delta?.content);
        if (content) yield { type: "text-delta", text: content };
        const toolCalls = Array.isArray(delta?.tool_calls) ? delta.tool_calls : [];
        for (const rawCall of toolCalls) {
          const call = record(rawCall);
          const index = number(call?.index) ?? 0;
          const toolCallId = string(call?.id) ?? toolCallIds.get(index) ?? `tool-${index}`;
          toolCallIds.set(index, toolCallId);
          const fn = record(call?.function);
          if (!openToolCalls.has(toolCallId)) {
            openToolCalls.add(toolCallId);
            yield { type: "tool-call-start", toolCallId, toolName: string(fn?.name) ?? "unknown" };
          }
          const argumentsDelta = string(fn?.arguments);
          if (argumentsDelta)
            yield { type: "tool-call-arguments-delta", toolCallId, argumentsDelta };
        }
        const nextFinishReason = string(choice?.finish_reason);
        if (nextFinishReason) {
          finishReason = nextFinishReason;
          hasFinished = true;
        }
        const usage = record(root?.usage);
        if (usage) {
          const inputTokens = number(usage.prompt_tokens);
          const outputTokens = number(usage.completion_tokens);
          const totalTokens = number(usage.total_tokens);
          yield {
            type: "usage",
            usage: {
              ...(inputTokens !== undefined ? { inputTokens } : {}),
              ...(outputTokens !== undefined ? { outputTokens } : {}),
              ...(totalTokens !== undefined ? { totalTokens } : {}),
            },
          };
        }
      }
      if (hasFinished) {
        for (const toolCallId of openToolCalls) yield { type: "tool-call-end", toolCallId };
        yield { type: "response-complete", responseId, finishReason };
      } else {
        yield {
          type: "error",
          error: {
            type: ProviderErrorType.NETWORK_ERROR,
            message: "Provider stream ended before completion",
            retryable: true,
          },
        };
      }
    } catch (error) {
      yield { type: "error", error: mapThrownError(error, params.signal) };
    }
  }

  private request(body: Record<string, unknown>, signal?: AbortSignal): Promise<Response> {
    return fetch(chatEndpoint(this.connection.baseUrl), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.connection.apiKey}`,
      },
      body: JSON.stringify(body),
      ...(signal ? { signal } : {}),
    });
  }
}
