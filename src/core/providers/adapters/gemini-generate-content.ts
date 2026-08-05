import { GeminiClient } from "./gemini-client";

const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com";

export class GeminiGenerateContentAdapter extends GeminiClient {
  constructor(initial?: Partial<{ providerId: string; baseUrl: string; apiKey: string }>) {
    super("gemini-generate-content", GEMINI_BASE_URL, initial);
  }
}
