// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { LOCAL_FILE_TOOLS } from "../../core/tools/builtin/local-file-tools";
import { BROWSER_TOOLS } from "../../core/tools/builtin/browser-tools";
import { createRuntime } from "../create-runtime";

describe("createRuntime component assembly", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("assembles the complete built-in tool graph for Desktop", () => {
    vi.stubEnv("VITE_EVIR_TARGET", "desktop");

    const runtime = createRuntime();

    expect(runtime.target).toBe("desktop");
    expect(
      runtime.toolRegistry
        ?.list()
        .map(({ id }) => id)
        .sort(),
    ).toEqual([...LOCAL_FILE_TOOLS, ...BROWSER_TOOLS].map(({ id }) => id).sort());
    expect(runtime.componentRuntime?.inspect().every(({ state }) => state === "active")).toBe(true);
  });

  it("applies component configuration before exposing the Runtime", () => {
    vi.stubEnv("VITE_EVIR_TARGET", "desktop");

    const runtime = createRuntime({
      componentConfiguration: {
        "evir.tools.terminal": { enabled: false },
      },
    });

    expect(runtime.toolRegistry?.get("run_command")).toBeUndefined();
    expect(runtime.toolRegistry?.get("read_file")).toBeDefined();
    expect(
      runtime.componentRuntime?.inspect().find(({ id }) => id === "evir.tools.terminal")?.state,
    ).toBe("disabled");
  });

  it("does not expose Desktop tool components in Web", () => {
    vi.stubEnv("VITE_EVIR_TARGET", "web");

    const runtime = createRuntime();

    expect(runtime.target).toBe("web");
    expect(runtime.toolRegistry?.list()).toEqual([]);
  });
});
