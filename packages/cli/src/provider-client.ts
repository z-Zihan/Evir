import { createConfiguredAdapter } from "../../../src/core/providers/adapter-registry";
import type { ProviderStreamEvent } from "../../../src/core/providers/stream-events";
import type { CliConfig } from "./types";

export interface ToolCall {
  id: string;
  name: string;
  arguments: string;
}

export interface ProviderTurn {
  content: string;
  toolCalls: ToolCall[];
  stopped: boolean;
  error?: string;
}

export async function streamProvider(options: {
  config: CliConfig;
  apiKey: string;
  messages: unknown[];
  tools?: unknown[];
  signal: AbortSignal;
  onDelta: (delta: string) => void;
}): Promise<ProviderTurn> {
  const adapter = createConfiguredAdapter(options.config.protocolId, {
    providerId: "evir-cli",
    baseUrl: options.config.baseUrl,
    apiKey: options.apiKey,
  });
  if (!adapter) {
    return {
      content: "",
      toolCalls: [],
      stopped: false,
      error: `Unsupported protocol: ${options.config.protocolId}`,
    };
  }
  let content = "";
  let error: string | undefined;
  const calls = new Map<string, ToolCall>();
  for await (const event of adapter.stream({
    modelId: options.config.modelId,
    messages: options.messages,
    ...(options.tools?.length ? { tools: options.tools } : {}),
    signal: options.signal,
  })) {
    consume(event, calls, (text) => {
      content += text;
      options.onDelta(text);
    });
    if (event.type === "error") error = event.error.message;
  }
  return {
    content,
    toolCalls: [...calls.values()],
    stopped: options.signal.aborted,
    ...(error ? { error } : {}),
  };
}

export async function testProvider(config: CliConfig, apiKey: string) {
  const adapter = createConfiguredAdapter(config.protocolId, {
    providerId: "evir-cli",
    baseUrl: config.baseUrl,
    apiKey,
  });
  if (!adapter) return { ok: false, error: "Unsupported protocol" };
  const result = await adapter.testConnection({
    providerId: "evir-cli",
    modelId: config.modelId,
    authConfig: { baseUrl: config.baseUrl, apiKey },
  });
  return result.ok ? { ok: true } : { ok: false, error: result.error?.message ?? "Unknown error" };
}

function consume(
  event: ProviderStreamEvent,
  calls: Map<string, ToolCall>,
  onText: (text: string) => void,
): void {
  if (event.type === "text-delta") onText(event.text);
  if (event.type === "tool-call-start") {
    calls.set(event.toolCallId, { id: event.toolCallId, name: event.toolName, arguments: "" });
  }
  if (event.type === "tool-call-arguments-delta") {
    const call = calls.get(event.toolCallId);
    if (call) call.arguments += event.argumentsDelta;
  }
}
