import type { ProtocolAdapter } from "./stream-events";
import type { ProtocolAdapterId } from "./types";
import { OpenAIChatCompletionsAdapter } from "./adapters/openai-chat-completions";
import { OpenAICompatibleChatAdapter } from "./adapters/openai-compatible-chat";
import type { OpenAIConnectionConfig } from "./adapters/openai-chat-client";

export function getAdapter(protocolId: ProtocolAdapterId): ProtocolAdapter | undefined {
  if (protocolId === "openai-chat-completions") return new OpenAIChatCompletionsAdapter();
  if (protocolId === "openai-compatible-chat") return new OpenAICompatibleChatAdapter();
  return undefined;
}

export function createConfiguredAdapter(
  protocolId: ProtocolAdapterId,
  config: OpenAIConnectionConfig,
): ProtocolAdapter | undefined {
  if (protocolId === "openai-chat-completions") {
    return new OpenAIChatCompletionsAdapter(config);
  }
  if (protocolId === "openai-compatible-chat") {
    return new OpenAICompatibleChatAdapter(config);
  }
  return undefined;
}
