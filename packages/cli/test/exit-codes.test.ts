import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { CliExitError, toExitCode } from "../src/exit-codes";
import { NotConfiguredError, readConfig } from "../src/config-store";
import { getProviderCredential } from "../src/credential-store";
import { streamProvider } from "../src/provider-client";
import { resolveWorkspace } from "../src/workspace-boundary";
import { runAgent } from "../src/agent";
import { main } from "../src/cli";

/**
 * docs/20 §6.2 target exit-code table: CliExitError/toExitCode unit
 * coverage, plus main() integration assertions for the codes that are not
 * already covered by cli-contract.test.ts (130 SIGINT, doctor's own 0/1/2).
 */

vi.mock("../src/config-store", async () => {
  const actual = await vi.importActual<typeof import("../src/config-store")>("../src/config-store");
  return { ...actual, readConfig: vi.fn() };
});
vi.mock("../src/credential-store", async () => {
  const actual =
    await vi.importActual<typeof import("../src/credential-store")>("../src/credential-store");
  return { ...actual, getProviderCredential: vi.fn() };
});
vi.mock("../src/provider-client", async () => {
  const actual =
    await vi.importActual<typeof import("../src/provider-client")>("../src/provider-client");
  return { ...actual, streamProvider: vi.fn() };
});
vi.mock("../src/workspace-boundary", () => ({ resolveWorkspace: vi.fn() }));
vi.mock("../src/agent", async () => {
  const actual = await vi.importActual<typeof import("../src/agent")>("../src/agent");
  return { ...actual, runAgent: vi.fn() };
});

const baseConfig = {
  id: "p1",
  name: "P",
  protocolId: "openai-compatible-chat" as const,
  baseUrl: "https://example.com/v1",
  modelId: "m",
  toolCalling: true,
  enabled: true,
  isDefault: true,
  createdAt: 1,
  updatedAt: 1,
};

describe("toExitCode", () => {
  it("maps CliExitError to its own code", () => {
    expect(toExitCode(new CliExitError(5, "workspace boom"))).toBe(5);
    expect(toExitCode(new CliExitError(7, "verification failed"))).toBe(7);
  });

  it("maps a ZodError to 2", () => {
    let caught: unknown;
    try {
      z.object({ a: z.string() }).parse({});
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(z.ZodError);
    expect(toExitCode(caught)).toBe(2);
  });

  it("maps NotConfiguredError to 2", () => {
    expect(toExitCode(new NotConfiguredError())).toBe(2);
  });

  it("maps any other error to 1", () => {
    expect(toExitCode(new Error("boom"))).toBe(1);
    expect(toExitCode("plain string")).toBe(1);
  });
});

describe("main() exit codes (docs/20 §6.2)", () => {
  const previousApiKey = process.env.EVIR_API_KEY;

  afterEach(() => {
    vi.clearAllMocks();
    if (previousApiKey === undefined) delete process.env.EVIR_API_KEY;
    else process.env.EVIR_API_KEY = previousApiKey;
  });

  it("returns 2 for an unknown command", async () => {
    expect(await main(["bogus-command"])).toBe(2);
  });

  it("returns 2 when no provider is configured", async () => {
    vi.mocked(readConfig).mockRejectedValueOnce(new NotConfiguredError());
    expect(await main(["ask", "hi"])).toBe(2);
  });

  it("returns 3 when EVIR_API_KEY is unset and no credential is stored", async () => {
    delete process.env.EVIR_API_KEY;
    vi.mocked(readConfig).mockResolvedValueOnce(baseConfig);
    vi.mocked(getProviderCredential).mockResolvedValueOnce(undefined);
    expect(await main(["ask", "hi"])).toBe(3);
  });

  it("returns 4 when the Provider stream reports an error", async () => {
    process.env.EVIR_API_KEY = "test-key";
    vi.mocked(readConfig).mockResolvedValueOnce(baseConfig);
    vi.mocked(streamProvider).mockResolvedValueOnce({
      content: "",
      toolCalls: [],
      stopped: false,
      error: "Provider request failed",
    });
    expect(await main(["ask", "hi"])).toBe(4);
  });

  it("returns 5 when workspace resolution fails", async () => {
    process.env.EVIR_API_KEY = "test-key";
    vi.mocked(readConfig).mockResolvedValueOnce(baseConfig);
    vi.mocked(resolveWorkspace).mockRejectedValueOnce(new Error("Path escapes the workspace"));
    expect(await main(["agent", "fix", "bug"])).toBe(5);
  });

  it("returns 7 when the Agent loop/step limit is hit", async () => {
    process.env.EVIR_API_KEY = "test-key";
    vi.mocked(readConfig).mockResolvedValueOnce(baseConfig);
    vi.mocked(resolveWorkspace).mockResolvedValueOnce("/tmp/workspace");
    vi.mocked(runAgent).mockResolvedValueOnce({
      content: "",
      error: "Agent reached the 10-step safety limit",
      errorKind: "runtime",
    });
    expect(await main(["agent", "fix", "bug"])).toBe(7);
  });
});
