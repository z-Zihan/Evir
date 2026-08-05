import { z } from "zod";
import type { ProtocolAdapterId } from "../types";
import {
  ProviderErrorType,
  type ProtocolAdapter,
  type ProviderError,
  type ProviderStreamEvent,
} from "../stream-events";
import { asNumber, asRecord, asString, mapThrownError, responseError } from "./openai-chat-utils";
import {
  responsesEndpoint,
  responsesInput,
  responseSseEvents,
  responsesStreamError,
  uuid,
} from "./openai-responses-utils";

interface ResponsesConnectionConfig {
  providerId: string;
  baseUrl: string;
  apiKey: string;
}

const authSchema = z.object({
  baseUrl: z.string().url().optional(),
  apiKey: z.string().min(1),
});

export class OpenAIResponsesClient implements ProtocolAdapter {
  private connection: ResponsesConnectionConfig;

  constructor(
    public readonly id: ProtocolAdapterId,
    defaultBaseUrl: string,
    initial?: Partial<ResponsesConnectionConfig>,
  ) {
    this.connection = {
      providerId: initial?.providerId ?? "openai",
      baseUrl: initial?.baseUrl ?? defaultBaseUrl,
      apiKey: initial?.apiKey ?? "",
    };
  }

  configure(config: ResponsesConnectionConfig): void {
    this.connection = { ...config, baseUrl: config.baseUrl.replace(/\/+$/, "") };
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
        input: [{ role: "user", content: [{ type: "input_text", text: "Hi" }] }],
        stream: false,
        max_output_tokens: 1,
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
    try {
      const response = await this.request(
        { model: params.modelId, input: responsesInput(params.messages), stream: true },
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
      for await (const sse of responseSseEvents(response.body)) {
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
        if (eventType === "response.output_text.delta") {
          const delta = asString(root?.delta);
          if (delta) yield { type: "text-delta", text: delta };
        } else if (eventType === "response.completed") {
          const completed = asRecord(root?.response);
          responseId = asString(completed?.id) ?? responseId;
          const usage = asRecord(completed?.usage);
          if (usage) {
            const inputTokens = asNumber(usage.input_tokens);
            const outputTokens = asNumber(usage.output_tokens);
            const totalTokens = asNumber(usage.total_tokens);
            yield {
              type: "usage",
              usage: {
                ...(inputTokens !== undefined ? { inputTokens } : {}),
                ...(outputTokens !== undefined ? { outputTokens } : {}),
                ...(totalTokens !== undefined ? { totalTokens } : {}),
              },
            };
          }
          yield {
            type: "response-complete",
            responseId,
            finishReason: asString(completed?.status) ?? "completed",
          };
          return;
        } else if (eventType === "response.failed" || eventType === "error") {
          yield { type: "error", error: responsesStreamError(root) };
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
    return fetch(responsesEndpoint(this.connection.baseUrl), {
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
