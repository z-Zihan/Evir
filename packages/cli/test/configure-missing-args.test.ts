import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NotConfiguredError, readConfig, writeConfig } from "../src/config-store";

/**
 * docs/20 §4.1/§12 step 1: `configure` with missing required flags no
 * longer prints raw Zod issues. Non-TTY gets a one-shot `configureMissingArgs`
 * error (exit 2); TTY stdin is prompted field-by-field via
 * `promptMissingConfigureValues`. All three flags present keeps the
 * pre-existing Zod-parse behavior unchanged.
 */

vi.mock("../src/config-store", async () => {
  const actual = await vi.importActual<typeof import("../src/config-store")>("../src/config-store");
  return { ...actual, readConfig: vi.fn(), writeConfig: vi.fn() };
});

const fakeStdin = new PassThrough() as unknown as NodeJS.ReadStream;
vi.mock("node:process", async () => {
  const actual = await vi.importActual<typeof import("node:process")>("node:process");
  return { ...actual, stdin: fakeStdin };
});

const previousApiKey = process.env.EVIR_API_KEY;
afterEach(() => {
  if (previousApiKey === undefined) delete process.env.EVIR_API_KEY;
  else process.env.EVIR_API_KEY = previousApiKey;
});

describe("configure missing-args handling (non-TTY)", () => {
  afterEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(fakeStdin, "isTTY", { value: false, configurable: true });
  });

  it("exits 2 with configureMissingArgs listing every missing flag when none are given", async () => {
    Object.defineProperty(fakeStdin, "isTTY", { value: false, configurable: true });
    vi.mocked(readConfig).mockRejectedValueOnce(new NotConfiguredError());
    const { main } = await import("../src/cli");
    const stderr: string[] = [];
    const spy = vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
      stderr.push(String(chunk));
      return true;
    });
    try {
      expect(await main(["configure"])).toBe(2);
      expect(stderr.join("")).toContain(
        "Missing required options: --protocol, --base-url, --model",
      );
      expect(stderr.join("")).toContain("evir configure --protocol");
    } finally {
      spy.mockRestore();
    }
  });

  it("exits 2 naming only the flags that are actually missing", async () => {
    Object.defineProperty(fakeStdin, "isTTY", { value: false, configurable: true });
    vi.mocked(readConfig).mockRejectedValueOnce(new NotConfiguredError());
    const { main } = await import("../src/cli");
    const stderr: string[] = [];
    const spy = vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
      stderr.push(String(chunk));
      return true;
    });
    try {
      expect(
        await main(["configure", "--protocol", "openai-compatible-chat", "--model", "gpt-4o"]),
      ).toBe(2);
      expect(stderr.join("")).toContain("Missing required options: --base-url");
      expect(stderr.join("")).not.toContain("--protocol,");
      expect(stderr.join("")).not.toContain("--model,");
    } finally {
      spy.mockRestore();
    }
  });

  it("does not report a flag as missing when a stored config already supplies it", async () => {
    Object.defineProperty(fakeStdin, "isTTY", { value: false, configurable: true });
    vi.mocked(readConfig).mockResolvedValueOnce({
      id: "p1",
      name: "P",
      protocolId: "openai-compatible-chat",
      baseUrl: "https://example.com/v1",
      modelId: "old-model",
      toolCalling: false,
      enabled: true,
      isDefault: true,
      createdAt: 1,
      updatedAt: 1,
    });
    vi.mocked(writeConfig).mockResolvedValueOnce(undefined);
    const { main } = await import("../src/cli");
    expect(await main(["configure", "--model", "gpt-4o"])).toBe(0);
    expect(writeConfig).toHaveBeenCalledWith(
      expect.objectContaining({ protocolId: "openai-compatible-chat", modelId: "gpt-4o" }),
    );
  });
});

describe("configure with all three flags present (unchanged behavior)", () => {
  afterEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(fakeStdin, "isTTY", { value: false, configurable: true });
  });

  it("parses and saves directly without prompting, exit 0", async () => {
    Object.defineProperty(fakeStdin, "isTTY", { value: false, configurable: true });
    vi.mocked(readConfig).mockRejectedValueOnce(new NotConfiguredError());
    vi.mocked(writeConfig).mockResolvedValueOnce(undefined);
    const { main } = await import("../src/cli");
    expect(
      await main([
        "configure",
        "--protocol",
        "openai-compatible-chat",
        "--base-url",
        "https://api.example.com/v1",
        "--model",
        "gpt-4o",
      ]),
    ).toBe(0);
    expect(writeConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        protocolId: "openai-compatible-chat",
        baseUrl: "https://api.example.com/v1",
        modelId: "gpt-4o",
      }),
    );
  });

  it("still surfaces the Zod issues summary for other validation failures (e.g. a malformed URL)", async () => {
    Object.defineProperty(fakeStdin, "isTTY", { value: false, configurable: true });
    vi.mocked(readConfig).mockRejectedValueOnce(new NotConfiguredError());
    const { main } = await import("../src/cli");
    const stderr: string[] = [];
    const spy = vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
      stderr.push(String(chunk));
      return true;
    });
    try {
      expect(
        await main([
          "configure",
          "--protocol",
          "openai-compatible-chat",
          "--base-url",
          "not-a-url",
          "--model",
          "gpt-4o",
        ]),
      ).toBe(2);
      expect(stderr.join("")).toContain("Invalid configure values:");
    } finally {
      spy.mockRestore();
    }
  });
});

describe("configure missing-args handling (TTY interactive)", () => {
  afterEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(fakeStdin, "isTTY", { value: false, configurable: true });
  });

  function sendLines(lines: string[]): void {
    for (const line of lines) fakeStdin.write(`${line}\n`);
  }

  it("prompts for missing fields in order, then saves after a y confirmation", async () => {
    Object.defineProperty(fakeStdin, "isTTY", { value: true, configurable: true });
    vi.mocked(readConfig).mockRejectedValueOnce(new NotConfiguredError());
    vi.mocked(writeConfig).mockResolvedValueOnce(undefined);
    const { main } = await import("../src/cli");
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      const resultPromise = main(["configure", "--protocol", "openai-compatible-chat"]);
      sendLines(["https://api.example.com/v1", "gpt-4o", "y"]);
      expect(await resultPromise).toBe(0);
      expect(writeConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          protocolId: "openai-compatible-chat",
          baseUrl: "https://api.example.com/v1",
          modelId: "gpt-4o",
        }),
      );
    } finally {
      stderrSpy.mockRestore();
    }
  });

  it("exits 2 with configureCancelled when the user sends Ctrl+C mid-prompt", async () => {
    Object.defineProperty(fakeStdin, "isTTY", { value: true, configurable: true });
    vi.mocked(readConfig).mockRejectedValueOnce(new NotConfiguredError());
    const { main } = await import("../src/cli");
    const stderr: string[] = [];
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
      stderr.push(String(chunk));
      return true;
    });
    try {
      const resultPromise = main(["configure"]);
      sendLines(["openai-compatible-chat", "\u0003"]);
      expect(await resultPromise).toBe(2);
      expect(stderr.join("")).toContain("Configuration cancelled");
    } finally {
      stderrSpy.mockRestore();
    }
  });
});

describe("configure confirmation summary (TTY interactive, docs/20 §4.1 step 2)", () => {
  afterEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(fakeStdin, "isTTY", { value: false, configurable: true });
  });

  function sendLines(lines: string[]): void {
    for (const line of lines) fakeStdin.write(`${line}\n`);
  }

  it("exits 2 and does not save when the confirmation is rejected and the edit prompt is then abandoned", async () => {
    Object.defineProperty(fakeStdin, "isTTY", { value: true, configurable: true });
    vi.mocked(readConfig).mockRejectedValueOnce(new NotConfiguredError());
    const { main } = await import("../src/cli");
    const stderr: string[] = [];
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
      stderr.push(String(chunk));
      return true;
    });
    try {
      const resultPromise = main(["configure", "--protocol", "openai-compatible-chat"]);
      // Rejecting the summary ("n") now opens the field-edit loop (docs/20
      // §4.1 step 3); an unrecognized answer ("nope") at its "which field"
      // prompt abandons the edit with the same cancellation exit as before.
      sendLines(["https://api.example.com/v1", "gpt-4o", "n", "nope"]);
      expect(await resultPromise).toBe(2);
      expect(writeConfig).not.toHaveBeenCalled();
      expect(stderr.join("")).toContain("Configuration cancelled");
    } finally {
      stderrSpy.mockRestore();
    }
  });

  it("does not show a confirmation prompt when all three flags are already present", async () => {
    Object.defineProperty(fakeStdin, "isTTY", { value: true, configurable: true });
    vi.mocked(readConfig).mockRejectedValueOnce(new NotConfiguredError());
    vi.mocked(writeConfig).mockResolvedValueOnce(undefined);
    const { main } = await import("../src/cli");
    const stderr: string[] = [];
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
      stderr.push(String(chunk));
      return true;
    });
    try {
      expect(
        await main([
          "configure",
          "--protocol",
          "openai-compatible-chat",
          "--base-url",
          "https://api.example.com/v1",
          "--model",
          "gpt-4o",
        ]),
      ).toBe(0);
      expect(writeConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          protocolId: "openai-compatible-chat",
          baseUrl: "https://api.example.com/v1",
          modelId: "gpt-4o",
        }),
      );
      expect(stderr.join("")).not.toContain("Save this configuration?");
    } finally {
      stderrSpy.mockRestore();
    }
  });

  it("echoes the EVIR_API_KEY override status in the summary without ever printing the key itself", async () => {
    process.env.EVIR_API_KEY = "sk-test-secret-12345";
    Object.defineProperty(fakeStdin, "isTTY", { value: true, configurable: true });
    vi.mocked(readConfig).mockRejectedValueOnce(new NotConfiguredError());
    const { main } = await import("../src/cli");
    const stderr: string[] = [];
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
      stderr.push(String(chunk));
      return true;
    });
    try {
      const resultPromise = main(["configure", "--protocol", "openai-compatible-chat"]);
      sendLines(["https://api.example.com/v1", "gpt-4o", "n", "nope"]);
      expect(await resultPromise).toBe(2);
      expect(writeConfig).not.toHaveBeenCalled();
      expect(stderr.join("")).toContain("will use the key from EVIR_API_KEY");
      expect(stderr.join("")).not.toContain("sk-test-secret-12345");
    } finally {
      stderrSpy.mockRestore();
    }
  });
});
