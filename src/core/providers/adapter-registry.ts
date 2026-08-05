import type { ProtocolAdapter } from "./stream-events";
import type { ProtocolAdapterId } from "./types";
import { OpenAIChatCompletionsAdapter } from "./adapters/openai-chat-completions";
import { OpenAICompatibleChatAdapter } from "./adapters/openai-compatible-chat";
import type { OpenAIConnectionConfig } from "./adapters/openai-chat-client";

const adapters: Partial<Record<ProtocolAdapterId, ProtocolAdapter>> = {
  "openai-chat-completions": new OpenAIChatCompletionsAdapter(),
  "openai-compatible-chat": new OpenAICompatibleChatAdapter(),
};

export function getAdapter(protocolId: ProtocolAdapterId): ProtocolAdapter | undefined {
  return adapters[protocolId];
}

export function configureAdapter(adapter: ProtocolAdapter, config: OpenAIConnectionConfig): void {
  if (
    adapter instanceof OpenAIChatCompletionsAdapter ||
    adapter instanceof OpenAICompatibleChatAdapter
  ) {
    adapter.configure(config);
  }
}
