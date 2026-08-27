// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

const runtime = vi.hoisted<{
  target: "desktop" | "web";
  saveTextFile: ReturnType<
    typeof vi.fn<(contents: string, suggestedName: string) => Promise<string | null>>
  >;
}>(() => ({
  target: "desktop",
  saveTextFile: vi.fn<(contents: string, suggestedName: string) => Promise<string | null>>(),
}));

vi.mock("../../../runtime/use-runtime", () => ({
  getRuntime: () => runtime,
}));

import { downloadBlob } from "../conversation-export";

describe("downloadBlob", () => {
  afterEach(() => {
    delete (globalThis as typeof globalThis & { __TAURI_INTERNALS__?: unknown })
      .__TAURI_INTERNALS__;
    runtime.target = "desktop";
    runtime.saveTextFile.mockReset();
  });

  it("uses the native save adapter in a Tauri Desktop window", async () => {
    (globalThis as typeof globalThis & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
    runtime.saveTextFile.mockResolvedValue("/tmp/evir-diagnostics.json");

    await expect(
      downloadBlob(
        { text: vi.fn().mockResolvedValue('{"safe":true}') } as unknown as Blob,
        "evir.json",
      ),
    ).resolves.toBe(true);

    expect(runtime.saveTextFile).toHaveBeenCalledWith('{"safe":true}', "evir.json");
  });

  it("reports a cancelled native save without navigating the WebView", async () => {
    (globalThis as typeof globalThis & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
    runtime.saveTextFile.mockResolvedValue(null);

    await expect(
      downloadBlob({ text: vi.fn().mockResolvedValue("[]") } as unknown as Blob, "evir.json"),
    ).resolves.toBe(false);
    expect(runtime.saveTextFile).toHaveBeenCalledOnce();
  });
});
