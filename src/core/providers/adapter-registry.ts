import type { ProtocolAdapter } from "./stream-events";
import type { ProtocolAdapterId } from "./types";
import { AnthropicMessagesAdapter } from "./adapters/anthropic-messages";
import { AzureOpenAIClient } from "./adapters/azure-openai-client";
import { GeminiGenerateContentAdapter } from "./adapters/gemini-generate-content";
import { OllamaClient } from "./adapters/ollama-client";
import { OpenAIChatCompletionsAdapter } from "./adapters/openai-chat-completions";
import { OpenAICompatibleChatAdapter } from "./adapters/openai-compatible-chat";
import { OpenAIResponsesAdapter } from "./adapters/openai-responses";
import type { OpenAIConnectionConfig } from "./adapters/openai-chat-client";

// Protocols with a usable adapter implementation. Readiness checks must ask
// this list instead of hardcoding their own — a hardcoded subset already
// drifted once and wrongly rejected azure-openai-chat / ollama-native.
const SUPPORTED_PROTOCOLS: ReadonlySet<string> = new Set<ProtocolAdapterId>([
  "anthropic-messages",
  "azure-openai-chat",
  "gemini-generate-content",
  "ollama-native",
  "openai-chat-completions",
  "openai-compatible-chat",
  "openai-responses",
]);

export function isSupportedProtocol(protocolId: string): boolean {
  return SUPPORTED_PROTOCOLS.has(protocolId);
}

export function getAdapter(protocolId: ProtocolAdapterId): ProtocolAdapter | undefined {
  if (protocolId === "anthropic-messages") return new AnthropicMessagesAdapter();
  if (protocolId === "azure-openai-chat") return new AzureOpenAIClient();
  if (protocolId === "gemini-generate-content") return new GeminiGenerateContentAdapter();
  if (protocolId === "ollama-native") return new OllamaClient();
  if (protocolId === "openai-chat-completions") return new OpenAIChatCompletionsAdapter();
  if (protocolId === "openai-compatible-chat") return new OpenAICompatibleChatAdapter();
  if (protocolId === "openai-responses") return new OpenAIResponsesAdapter();
  return undefined;
}

export function createConfiguredAdapter(
  protocolId: string,
  config: OpenAIConnectionConfig,
): ProtocolAdapter | undefined {
  if (protocolId === "anthropic-messages") return new AnthropicMessagesAdapter(config);
  if (protocolId === "azure-openai-chat") return new AzureOpenAIClient(config);
  if (protocolId === "gemini-generate-content") {
    return new GeminiGenerateContentAdapter(config);
  }
  if (protocolId === "ollama-native") return new OllamaClient(config);
  if (protocolId === "openai-chat-completions") {
    return new OpenAIChatCompletionsAdapter(config);
  }
  if (protocolId === "openai-compatible-chat") {
    return new OpenAICompatibleChatAdapter(config);
  }
  if (protocolId === "openai-responses") return new OpenAIResponsesAdapter(config);
  return undefined;
}

export function listModelsForProtocol(
  protocolId: string,
  config: OpenAIConnectionConfig,
): Promise<string[] | undefined> {
  const adapter = createConfiguredAdapter(protocolId, config);
  return (
    adapter?.listModels?.({
      authConfig: { baseUrl: config.baseUrl, apiKey: config.apiKey },
    }) ?? Promise.resolve(undefined)
  );
}
