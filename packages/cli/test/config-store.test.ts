import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { defaultConfigPath, readConfig, writeConfig } from "../src/config-store";

const temporary: string[] = [];

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((directory) => rm(directory, { recursive: true })));
});

describe("CLI configuration", () => {
  it("uses the explicit Evir config directory", () => {
    expect(defaultConfigPath({ EVIR_CONFIG_DIR: "/tmp/custom" })).toBe(
      path.join("/tmp/custom", "evir", "providers.json"),
    );
  });

  it("writes only validated non-secret configuration with private permissions", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "evir-cli-config-"));
    temporary.push(directory);
    const target = path.join(directory, "config.json");
    const config = {
      id: "provider-1",
      name: "Test Provider",
      protocolId: "openai-compatible-chat" as const,
      baseUrl: "https://example.com/v1",
      modelId: "model",
      toolCalling: true,
      enabled: true,
      isDefault: true,
      createdAt: 1,
      updatedAt: 2,
    };
    await writeConfig(config, target);
    expect(await readConfig(target)).toEqual(config);
    expect(await readFile(target, "utf8")).not.toContain("apiKey");
    if (process.platform !== "win32") expect((await stat(target)).mode & 0o777).toBe(0o600);
  });

  it("keeps one default Provider when the CLI updates a Desktop profile", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "evir-cli-config-"));
    temporary.push(directory);
    const target = path.join(directory, "providers.json");
    const base = {
      protocolId: "openai-compatible-chat" as const,
      baseUrl: "https://example.com/v1",
      modelId: "model",
      toolCalling: true,
      enabled: true,
      createdAt: 1,
      updatedAt: 2,
    };
    await writeConfig({ ...base, id: "desktop", name: "Desktop", isDefault: true }, target);
    await writeConfig({ ...base, id: "cli", name: "CLI", isDefault: true }, target);

    const document = JSON.parse(await readFile(target, "utf8")) as {
      providers: Array<{ id: string; isDefault: boolean }>;
    };
    expect(document.providers.filter((provider) => provider.isDefault)).toEqual([
      expect.objectContaining({ id: "cli" }),
    ]);
  });

  it("rejects unknown fields so a secret cannot be smuggled into the shared file", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "evir-cli-config-"));
    temporary.push(directory);
    const target = path.join(directory, "providers.json");
    await expect(
      writeConfig(
        {
          id: "provider",
          name: "Provider",
          protocolId: "openai-compatible-chat",
          baseUrl: "https://example.com/v1",
          modelId: "model",
          toolCalling: false,
          enabled: true,
          isDefault: true,
          createdAt: 1,
          updatedAt: 1,
          apiKey: "must-not-persist",
        } as never,
        target,
      ),
    ).rejects.toThrow();
  });
});
