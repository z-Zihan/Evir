// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import { isSupportedProtocol } from "../../../core/providers/adapter-registry";
import { providerReadinessError } from "../chat-stream";
import type { ProviderRecord } from "../../../core/storage/db";

function provider(overrides: Partial<ProviderRecord>): ProviderRecord {
  return {
    id: "p1",
    name: "P",
    protocolId: "openai-chat-completions",
    baseUrl: "https://example.com/v1",
    apiKey: "key",
    modelId: "m1",
    enabled: true,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  } as ProviderRecord;
}

describe("providerReadinessError follows the adapter registry", () => {
  it("accepts every protocol the registry can construct", () => {
    for (const protocolId of [
      "anthropic-messages",
      "azure-openai-chat",
      "gemini-generate-content",
      "ollama-native",
      "openai-chat-completions",
      "openai-compatible-chat",
      "openai-responses",
    ]) {
      expect(isSupportedProtocol(protocolId)).toBe(true);
      expect(providerReadinessError(provider({ protocolId }))).toBeUndefined();
    }
  });

  it("rejects unknown protocols", () => {
    expect(providerReadinessError(provider({ protocolId: "no-such-protocol" }))).toBe(
      "chat.protocolUnsupported",
    );
  });

  it("requires an api key first", () => {
    expect(providerReadinessError(provider({ apiKey: "" }))).toBe("chat.apiKeyMissing");
  });
});
