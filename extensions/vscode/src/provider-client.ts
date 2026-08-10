import { createConfiguredAdapter } from "../../../src/core/providers/adapter-registry";
import type { ProviderStreamEvent } from "../../../src/core/providers/stream-events";
import type { ProviderConfig } from "./types";

export interface ModelToolCall {
  id: string;
  name: string;
  arguments: string;
}

export interface ProviderTurn {
  content: string;
  toolCalls: ModelToolCall[];
  completed: boolean;
  stopped: boolean;
  error?: string;
}

export class ProviderClient {
  async test(config: ProviderConfig, apiKey: string): Promise<{ ok: boolean; error?: string }> {
    const adapter = this.createAdapter(config, apiKey);
    if (!adapter) return { ok: false, error: `Unsupported protocol: ${config.protocolId}` };
    const result = await adapter.testConnection({
      providerId: "evir-vscode",
      modelId: config.modelId,
      authConfig: { baseUrl: config.baseUrl, apiKey },
    });
    return result.ok
      ? { ok: true }
      : { ok: false, error: result.error?.message ?? "Unknown error" };
  }

  async stream(
    config: ProviderConfig,
    apiKey: string,
    messages: unknown[],
    tools: unknown[] | undefined,
    signal: AbortSignal,
    onDelta: (content: string) => void,
  ): Promise<ProviderTurn> {
    const adapter = this.createAdapter(config, apiKey);
    if (!adapter) {
      return {
        content: "",
        toolCalls: [],
        completed: false,
        stopped: false,
        error: `Unsupported protocol: ${config.protocolId}`,
      };
    }

    let content = "";
    let completed = false;
    let error: string | undefined;
    const calls = new Map<string, ModelToolCall>();
    for await (const event of adapter.stream({
      modelId: config.modelId,
      messages,
      ...(tools?.length ? { tools } : {}),
      signal,
    })) {
      this.consumeEvent(event, calls, (text) => {
        content += text;
        onDelta(content);
      });
      if (event.type === "response-complete") completed = true;
      if (event.type === "error") error = event.error.message;
    }
    return {
      content,
      toolCalls: [...calls.values()],
      completed,
      stopped: signal.aborted,
      ...(error ? { error } : {}),
    };
  }

  private createAdapter(config: ProviderConfig, apiKey: string) {
    return createConfiguredAdapter(config.protocolId, {
      providerId: "evir-vscode",
      baseUrl: config.baseUrl,
      apiKey,
    });
  }

  private consumeEvent(
    event: ProviderStreamEvent,
    calls: Map<string, ModelToolCall>,
    onText: (text: string) => void,
  ): void {
    if (event.type === "text-delta") onText(event.text);
    if (event.type === "tool-call-start") {
      calls.set(event.toolCallId, {
        id: event.toolCallId,
        name: event.toolName,
        arguments: "",
      });
    }
    if (event.type === "tool-call-arguments-delta") {
      const call = calls.get(event.toolCallId);
      if (call) call.arguments += event.argumentsDelta;
    }
  }
}
