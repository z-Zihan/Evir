import { beforeEach, describe, expect, it, vi } from "vitest";
import { BROWSER_TOOLS } from "../builtin/browser-tools";
import type { EvirRuntime } from "../../../runtime/types";

const invokeMock = vi.fn<(command: string, args?: Record<string, unknown>) => Promise<unknown>>();

vi.mock("../../../runtime/tauri-ipc", () => ({
  tauriInvoke: (command: string, args?: Record<string, unknown>): Promise<unknown> =>
    invokeMock(command, args),
}));

function desktopRuntime(): EvirRuntime {
  const capabilities = new Set(["chat", "browserAutomation"]);
  return {
    target: "desktop",
    capabilities,
    has: (capability) => capabilities.has(capability),
  } as EvirRuntime;
}

function webRuntime(): EvirRuntime {
  const capabilities = new Set(["chat"]);
  return {
    target: "web",
    capabilities,
    has: (capability) => capabilities.has(capability),
  } as EvirRuntime;
}

const TOOL_BY_ID = new Map(BROWSER_TOOLS.map((tool) => [tool.id, tool]));

beforeEach(() => {
  invokeMock.mockReset();
});

describe("browser tool surface", () => {
  it("covers the required read/interaction tool set", () => {
    for (const id of [
      "browser_open",
      "browser_navigate",
      "browser_back",
      "browser_forward",
      "browser_reload",
      "browser_snapshot",
      "browser_screenshot",
      "browser_click",
      "browser_fill",
      "browser_select",
      "browser_press",
      "browser_scroll",
      "browser_get_text",
      "browser_get_url",
      "browser_tabs",
      "browser_switch_tab",
      "browser_close_tab",
      "browser_wait",
    ]) {
      expect(TOOL_BY_ID.has(id), `missing tool ${id}`).toBe(true);
    }
  });

  it("does not expose a raw JS evaluation tool", () => {
    expect(BROWSER_TOOLS.some((tool) => /eval|execute_script/.test(tool.id))).toBe(false);
  });

  it("assigns L1 to reads and L2+ to interactions", () => {
    expect(TOOL_BY_ID.get("browser_open")?.riskLevel).toBe("L1");
    expect(TOOL_BY_ID.get("browser_snapshot")?.riskLevel).toBe("L1");
    expect(TOOL_BY_ID.get("browser_screenshot")?.riskLevel).toBe("L1");
    expect(TOOL_BY_ID.get("browser_click")?.riskLevel).toBe("L2");
    expect(TOOL_BY_ID.get("browser_fill")?.riskLevel).toBe("L2");
    expect(TOOL_BY_ID.get("browser_press")?.riskLevel).toBe("L2");
  });

  it("requires the browserAutomation capability and desktop runtime", () => {
    for (const tool of BROWSER_TOOLS) {
      expect(tool.requiredCapability).toBe("browserAutomation");
      expect(tool.source).toBe("evir-local");
    }
  });

  it("keeps tool ids unique", () => {
    const ids = BROWSER_TOOLS.map((tool) => tool.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("browser tool execution", () => {
  it("returns unavailable on the web runtime", async () => {
    const tool = TOOL_BY_ID.get("browser_snapshot")!;
    const result = await tool.execute({}, webRuntime());
    expect(result.success).toBe(false);
    expect(result.error).toBe("not_available_in_browser");
  });

  it("invokes the matching Rust command on desktop", async () => {
    invokeMock.mockResolvedValueOnce({ snapshot: '@e1 button "Go"' });
    const tool = TOOL_BY_ID.get("browser_snapshot")!;
    const result = await tool.execute({}, desktopRuntime());
    expect(invokeMock).toHaveBeenCalledWith("browser_snapshot", {});
    expect(result.success).toBe(true);
    expect(result.output).toContain("@e1");
  });

  it("validates arguments before invoking", async () => {
    const tool = TOOL_BY_ID.get("browser_open")!;
    const result = await tool.execute({ url: "" }, desktopRuntime());
    expect(result.success).toBe(false);
    expect(result.error).toBe("invalid_args");
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("surfaces runtime errors as tool errors", async () => {
    invokeMock.mockRejectedValueOnce(new Error("no compatible browser found"));
    const tool = TOOL_BY_ID.get("browser_open")!;
    const result = await tool.execute({ url: "https://example.com" }, desktopRuntime());
    expect(result.success).toBe(false);
    expect(result.error).toBe("browser_error");
    expect(result.output).toContain("no compatible browser found");
  });

  it("caps tool output size", async () => {
    invokeMock.mockResolvedValueOnce({ text: "x".repeat(50_000) });
    const tool = TOOL_BY_ID.get("browser_get_text")!;
    const result = await tool.execute({}, desktopRuntime());
    expect(result.output.length).toBeLessThan(10_000);
  });

  it("respects abort signals", async () => {
    const tool = TOOL_BY_ID.get("browser_snapshot")!;
    const controller = new AbortController();
    controller.abort();
    const result = await tool.execute({}, desktopRuntime(), controller.signal);
    expect(result.success).toBe(false);
    expect(result.error).toBe("aborted");
  });

  it("maps interaction args onto Rust parameter names", async () => {
    invokeMock.mockResolvedValueOnce({ clicked: "@e2" });
    const tool = TOOL_BY_ID.get("browser_click")!;
    await tool.execute({ element_ref: "@e2" }, desktopRuntime());
    expect(invokeMock).toHaveBeenCalledWith("browser_click", { element_ref: "@e2" });
  });
});
