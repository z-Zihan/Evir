import type * as vscode from "vscode";
import { describe, expect, it } from "vitest";
import { ConversationStore } from "../src/conversation-store";
import { ProviderStore } from "../src/provider-store";
import { providerConfigSchema, webviewMessageSchema } from "../src/types";

function contextFixture() {
  const global = new Map<string, unknown>();
  const workspace = new Map<string, unknown>();
  const secrets = new Map<string, string>();
  const state = (values: Map<string, unknown>) => ({
    get: <T>(key: string) => values.get(key) as T | undefined,
    update: (key: string, value: unknown) => {
      if (value === undefined) values.delete(key);
      else values.set(key, value);
      return Promise.resolve();
    },
    keys: () => [...values.keys()],
    setKeysForSync: () => undefined,
  });
  const context = {
    globalState: state(global),
    workspaceState: state(workspace),
    secrets: {
      get: (key: string) => Promise.resolve(secrets.get(key)),
      store: (key: string, value: string) => {
        secrets.set(key, value);
        return Promise.resolve();
      },
      delete: (key: string) => {
        secrets.delete(key);
        return Promise.resolve();
      },
      onDidChange: { dispose: () => undefined },
    },
  } as unknown as vscode.ExtensionContext;
  return { context, global, workspace, secrets };
}

const validConfig = {
  protocolId: "openai-compatible-chat" as const,
  baseUrl: "https://example.com/v1",
  modelId: "example-model",
  toolCalling: true,
};

describe("extension input validation", () => {
  it("accepts supported provider configuration and rejects unsafe UI messages", () => {
    expect(providerConfigSchema.safeParse(validConfig).success).toBe(true);
    expect(providerConfigSchema.safeParse({ ...validConfig, baseUrl: "not a url" }).success).toBe(
      false,
    );
    expect(webviewMessageSchema.safeParse({ type: "send", text: "", mode: "agent" }).success).toBe(
      false,
    );
    expect(
      webviewMessageSchema.safeParse({ type: "approve", requestId: "not-a-uuid" }).success,
    ).toBe(false);
  });
});

describe("ProviderStore", () => {
  it("keeps provider metadata and API keys in separate storage", async () => {
    const fixture = contextFixture();
    const store = new ProviderStore(fixture.context);
    await store.save(validConfig, "secret-value");

    expect(store.getConfig()).toEqual(validConfig);
    expect(await store.getApiKey()).toBe("secret-value");
    expect(JSON.stringify([...fixture.global.values()])).not.toContain("secret-value");
    expect(fixture.secrets.get("evir.provider.apiKey")).toBe("secret-value");
  });

  it("does not erase a saved key when the settings field is left blank", async () => {
    const fixture = contextFixture();
    const store = new ProviderStore(fixture.context);
    await store.save(validConfig, "secret-value");
    await store.save({ ...validConfig, modelId: "new-model" }, "");
    expect(await store.getApiKey()).toBe("secret-value");
  });
});

describe("ConversationStore", () => {
  it("bounds persisted conversation history", async () => {
    const fixture = contextFixture();
    const store = new ConversationStore(fixture.context);
    for (let index = 0; index < 105; index += 1) {
      await store.append({
        id: String(index),
        role: "user",
        content: `Message ${index}`,
        createdAt: index,
      });
    }
    expect(store.list()).toHaveLength(100);
    expect(store.list()[0]?.id).toBe("5");
  });
});
