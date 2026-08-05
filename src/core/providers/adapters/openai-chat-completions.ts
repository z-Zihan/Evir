import { OpenAIChatClient, type OpenAIConnectionConfig } from "./openai-chat-client";

const OPENAI_BASE_URL = "https://api.openai.com/v1";

export class OpenAIChatCompletionsAdapter extends OpenAIChatClient {
  constructor(initial?: Partial<OpenAIConnectionConfig>) {
    super("openai-chat-completions", OPENAI_BASE_URL, initial);
  }
}
