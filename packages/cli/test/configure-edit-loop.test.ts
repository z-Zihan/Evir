import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NotConfiguredError, readConfig, writeConfig } from "../src/config-store";
import { setProviderCredential } from "../src/credential-store";

/**
 * docs/20 §4.1 step 3: once the save-confirmation summary is rejected,
 * `configure` opens a field-edit loop instead of exiting immediately —
 * pick a field (protocol/base-url/model), re-answer it, see the recomputed
 * summary, and confirm again; it keeps looping until accepted or abandoned.
 * These integration tests drive that loop through `main()`'s real stdin
 * injection, the same pattern configure-missing-args.test.ts uses, so the
 * whole prompt -> confirm -> edit -> re-confirm sequence runs over one
 * shared LineReader exactly as it does on a real TTY.
 */

vi.mock("../src/config-store", async () => {
  const actual = await vi.importActual<typeof import("../src/config-store")>("../src/config-store");
  return { ...actual, readConfig: vi.fn(), writeConfig: vi.fn() };
});
vi.mock("../src/credential-store", async () => {
  const actual =
    await vi.importActual<typeof import("../src/credential-store")>("../src/credential-store");
  return { ...actual, setProviderCredential: vi.fn() };
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
  vi.clearAllMocks();
  Object.defineProperty(fakeStdin, "isTTY", { value: false, configurable: true });
});

function sendLines(lines: string[]): void {
  for (const line of lines) fakeStdin.write(`${line}\n`);
}

describe("configure edit loop (TTY interactive, docs/20 §4.1 step 3)", () => {
  it("regression: completes prompt -> confirm(reject) -> edit -> re-confirm(accept) over one shared stdin stream without starving", async () => {
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
      const resultPromise = main(["configure", "--protocol", "openai-compatible-chat"]);
      // Missing-field prompt, then reject the first summary, then edit the
      // model field, then accept the recomputed summary — all injected onto
      // the same stdin stream main() reads from end to end.
      sendLines(["https://api.example.com/v1", "gpt-4o", "n", "model", "gpt-4o-mini", "y"]);
      expect(await resultPromise).toBe(0);
      expect(writeConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          protocolId: "openai-compatible-chat",
          baseUrl: "https://api.example.com/v1",
          modelId: "gpt-4o-mini",
        }),
      );
      expect(stderr.join("")).toContain("gpt-4o-mini");
    } finally {
      stderrSpy.mockRestore();
    }
  });

  it("saves the edited base URL after the loop reconfirms", async () => {
    Object.defineProperty(fakeStdin, "isTTY", { value: true, configurable: true });
    vi.mocked(readConfig).mockRejectedValueOnce(new NotConfiguredError());
    vi.mocked(writeConfig).mockResolvedValueOnce(undefined);
    const { main } = await import("../src/cli");
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      const resultPromise = main(["configure", "--protocol", "openai-compatible-chat"]);
      sendLines([
        "https://api.example.com/v1",
        "gpt-4o",
        "n",
        "base-url",
        "https://changed.example.com/v1",
        "y",
      ]);
      expect(await resultPromise).toBe(0);
      expect(writeConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          baseUrl: "https://changed.example.com/v1",
          modelId: "gpt-4o",
        }),
      );
    } finally {
      stderrSpy.mockRestore();
    }
  });

  it("loops through multiple rejections before saving", async () => {
    Object.defineProperty(fakeStdin, "isTTY", { value: true, configurable: true });
    vi.mocked(readConfig).mockRejectedValueOnce(new NotConfiguredError());
    vi.mocked(writeConfig).mockResolvedValueOnce(undefined);
    const { main } = await import("../src/cli");
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      const resultPromise = main(["configure", "--protocol", "openai-compatible-chat"]);
      sendLines([
        "https://api.example.com/v1",
        "gpt-4o",
        "n",
        "model",
        "gpt-4o-mini",
        "n",
        "base-url",
        "https://second.example.com/v1",
        "y",
      ]);
      expect(await resultPromise).toBe(0);
      expect(writeConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          baseUrl: "https://second.example.com/v1",
          modelId: "gpt-4o-mini",
        }),
      );
    } finally {
      stderrSpy.mockRestore();
    }
  });

  it("recalculates apiKeyStatus and skips the API key prompt after switching to ollama-native", async () => {
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
      const resultPromise = main(["configure", "--protocol", "openai-compatible-chat"]);
      sendLines(["https://api.example.com/v1", "gpt-4o", "n", "protocol", "ollama-native", "y"]);
      expect(await resultPromise).toBe(0);
      expect(writeConfig).toHaveBeenCalledWith(
        expect.objectContaining({ protocolId: "ollama-native" }),
      );
      expect(stderr.join("")).toContain("not required (ollama-native)");
    } finally {
      stderrSpy.mockRestore();
    }
  });

  it("still caps invalid base URL retries at two while editing", async () => {
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
      const resultPromise = main(["configure", "--protocol", "openai-compatible-chat"]);
      sendLines([
        "https://api.example.com/v1",
        "gpt-4o",
        "n",
        "base-url",
        "not-a-url",
        "still-not",
        "https://ok.example.com/v1",
        "y",
      ]);
      expect(await resultPromise).toBe(0);
      expect(writeConfig).toHaveBeenCalledWith(
        expect.objectContaining({ baseUrl: "https://ok.example.com/v1" }),
      );
      const retryCount = stderr.join("").split("Invalid URL, try again:").length - 1;
      expect(retryCount).toBe(2);
    } finally {
      stderrSpy.mockRestore();
    }
  });

  it("exits 2 and writes nothing when the which-field prompt is abandoned with an unrecognized answer", async () => {
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
      sendLines(["https://api.example.com/v1", "gpt-4o", "n", "whatever"]);
      expect(await resultPromise).toBe(2);
      expect(writeConfig).not.toHaveBeenCalled();
      expect(stderr.join("")).toContain("Configuration cancelled");
    } finally {
      stderrSpy.mockRestore();
    }
  });

  it("exits 2 and writes nothing when the which-field prompt is cancelled with an explicit 'cancel'", async () => {
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
      sendLines(["https://api.example.com/v1", "gpt-4o", "n", "cancel"]);
      expect(await resultPromise).toBe(2);
      expect(writeConfig).not.toHaveBeenCalled();
      expect(stderr.join("")).toContain("Configuration cancelled");
    } finally {
      stderrSpy.mockRestore();
    }
  });

  it("exits 2 and writes nothing on Ctrl+C inside the edit loop", async () => {
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
      sendLines(["https://api.example.com/v1", "gpt-4o", "n", "model", "\u0003"]);
      expect(await resultPromise).toBe(2);
      expect(writeConfig).not.toHaveBeenCalled();
      expect(stderr.join("")).toContain("Configuration cancelled");
    } finally {
      stderrSpy.mockRestore();
    }
  });

  it("never prints a plaintext EVIR_API_KEY anywhere during the edit loop", async () => {
    process.env.EVIR_API_KEY = "sk-test-secret-98765";
    Object.defineProperty(fakeStdin, "isTTY", { value: true, configurable: true });
    vi.mocked(readConfig).mockRejectedValueOnce(new NotConfiguredError());
    vi.mocked(writeConfig).mockResolvedValueOnce(undefined);
    vi.mocked(setProviderCredential).mockResolvedValueOnce(undefined);
    const { main } = await import("../src/cli");
    const stderr: string[] = [];
    const stdout: string[] = [];
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
      stderr.push(String(chunk));
      return true;
    });
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
      stdout.push(String(chunk));
      return true;
    });
    try {
      const resultPromise = main(["configure", "--protocol", "openai-compatible-chat"]);
      sendLines(["https://api.example.com/v1", "gpt-4o", "n", "model", "gpt-4o-mini", "y"]);
      expect(await resultPromise).toBe(0);
      expect(setProviderCredential).toHaveBeenCalledWith(
        expect.any(String),
        "sk-test-secret-98765",
      );
      expect(stderr.join("")).not.toContain("sk-test-secret-98765");
      expect(stdout.join("")).not.toContain("sk-test-secret-98765");
    } finally {
      stderrSpy.mockRestore();
      stdoutSpy.mockRestore();
    }
  });

  // This test ends the shared fakeStdin stream outright (there is no way to
  // simulate real EOF otherwise), so it must stay the last test in this
  // file — nothing can be written to fakeStdin again afterwards.
  it("exits 2 and writes nothing on EOF inside the edit loop (stdin ends before an answer)", async () => {
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
      sendLines(["https://api.example.com/v1", "gpt-4o", "n"]);
      fakeStdin.end();
      expect(await resultPromise).toBe(2);
      expect(writeConfig).not.toHaveBeenCalled();
      expect(stderr.join("")).toContain("Configuration cancelled");
    } finally {
      stderrSpy.mockRestore();
    }
  });
});
