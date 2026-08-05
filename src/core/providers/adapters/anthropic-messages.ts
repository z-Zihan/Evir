import { AnthropicMessagesClient } from "./anthropic-messages-client";

const ANTHROPIC_BASE_URL = "https://api.anthropic.com";

export class AnthropicMessagesAdapter extends AnthropicMessagesClient {
  constructor(initial?: Partial<{ providerId: string; baseUrl: string; apiKey: string }>) {
    super("anthropic-messages", ANTHROPIC_BASE_URL, initial);
  }
}
