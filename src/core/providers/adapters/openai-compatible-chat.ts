import { OpenAIChatClient, type OpenAIConnectionConfig } from "./openai-chat-client";

const LOCAL_COMPATIBLE_BASE_URL = "http://localhost:11434/v1";

export class OpenAICompatibleChatAdapter extends OpenAIChatClient {
  constructor(initial?: Partial<OpenAIConnectionConfig>) {
    super("openai-compatible-chat", initial?.baseUrl ?? LOCAL_COMPATIBLE_BASE_URL, initial);
  }
}
