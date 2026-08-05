import { OpenAIResponsesClient } from "./openai-responses-client";

const OPENAI_BASE_URL = "https://api.openai.com/v1";

export class OpenAIResponsesAdapter extends OpenAIResponsesClient {
  constructor(initial?: Partial<{ providerId: string; baseUrl: string; apiKey: string }>) {
    super("openai-responses", OPENAI_BASE_URL, initial);
  }
}
