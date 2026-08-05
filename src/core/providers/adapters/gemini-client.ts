import { z } from "zod";
import type { ProtocolAdapterId } from "../types";
import {
  ProviderErrorType,
  type ProtocolAdapter,
  type ProviderError,
  type ProviderStreamEvent,
} from "../stream-events";
import { asNumber, asRecord, asString, dataLines, mapThrownError } from "./openai-chat-utils";
import { geminiRequestMessages, geminiResponseError, uuid } from "./gemini-utils";

interface GeminiConnectionConfig {
  providerId: string;
  baseUrl: string;
  apiKey: string;
}

const authSchema = z.object({
  baseUrl: z.string().url().optional(),
  apiKey: z.string().min(1),
});

export class GeminiClient implements ProtocolAdapter {
  private connection: GeminiConnectionConfig;

  constructor(
    public readonly id: ProtocolAdapterId,
    defaultBaseUrl: string,
    initial?: Partial<GeminiConnectionConfig>,
  ) {
    this.connection = {
      providerId: initial?.providerId ?? "gemini",
      baseUrl: initial?.baseUrl ?? defaultBaseUrl,
      apiKey: initial?.apiKey ?? "",
    };
  }

  configure(config: GeminiConnectionConfig): void {
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
      const response = await this.request(config.modelId, false, {
        contents: [{ role: "user", parts: [{ text: "Hi" }] }],
        generationConfig: { maxOutputTokens: 1 },
      });
      return response.ok ? { ok: true } : { ok: false, error: await geminiResponseError(response) };
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
    const responseId = uuid();
    try {
      const response = await this.request(
        params.modelId,
        true,
        geminiRequestMessages(params.messages),
        params.signal,
      );
      if (!response.ok) {
        yield { type: "error", error: await geminiResponseError(response) };
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
        const root = asRecord(payload);
        const candidates = Array.isArray(root?.candidates) ? root.candidates : [];
        const candidate = asRecord(candidates[0]);
        const parts = asRecord(candidate?.content)?.parts;
        if (Array.isArray(parts)) {
          for (const part of parts) {
            const text = asString(asRecord(part)?.text);
            if (text) yield { type: "text-delta", text };
          }
        }
        const usage = asRecord(root?.usageMetadata);
        if (usage) {
          const inputTokens = asNumber(usage.promptTokenCount);
          const outputTokens = asNumber(usage.candidatesTokenCount);
          const totalTokens = asNumber(usage.totalTokenCount);
          yield {
            type: "usage",
            usage: {
              ...(inputTokens !== undefined ? { inputTokens } : {}),
              ...(outputTokens !== undefined ? { outputTokens } : {}),
              ...(totalTokens !== undefined ? { totalTokens } : {}),
            },
          };
        }
        const finishReason = asString(candidate?.finishReason);
        if (finishReason) {
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

  private request(
    model: string,
    stream: boolean,
    body: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<Response> {
    const action = stream ? "streamGenerateContent" : "generateContent";
    const query = stream ? "alt=sse" : "";
    const baseUrl = this.connection.baseUrl.replace(/\/+$/, "");
    return fetch(
      `${baseUrl}/v1beta/models/${encodeURIComponent(model)}:${action}${query ? `?${query}` : ""}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": this.connection.apiKey },
        body: JSON.stringify(body),
        ...(signal ? { signal } : {}),
      },
    );
  }
}
