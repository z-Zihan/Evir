import { beforeEach, describe, expect, it, vi } from "vitest";
import { COMPUTER_TOOLS } from "../builtin/computer-tools";
import { TOOL_NOT_AVAILABLE } from "../tool-executor";
import type { EvirRuntime } from "../../../runtime/types";

const invokeMock = vi.fn<(command: string, args?: Record<string, unknown>) => Promise<unknown>>();

vi.mock("../../../runtime/tauri-ipc", () => ({
  tauriInvoke: (command: string, args?: Record<string, unknown>): Promise<unknown> =>
    invokeMock(command, args),
}));

function runtimeFor(target: "web" | "desktop", capabilities: string[]): EvirRuntime {
  const set = new Set(capabilities);
  return {
    target,
    capabilities: set,
    has: (capability) => set.has(capability),
  } as EvirRuntime;
}

function desktopRuntime(): EvirRuntime {
  return runtimeFor("desktop", ["chat", "computerUse"]);
}

const TOOL_BY_ID = new Map(COMPUTER_TOOLS.map((tool) => [tool.id, tool]));

beforeEach(() => {
  invokeMock.mockReset();
});

describe("computer-use tool surface", () => {
  it("exposes read-only capture plus gated desktop control, all behind computerUse", () => {
    expect(COMPUTER_TOOLS.map(({ id }) => id).sort()).toEqual([
      "computer_click",
      "computer_frontmost_app",
      "computer_key",
      "computer_screenshot",
      "computer_type",
    ]);
    for (const tool of COMPUTER_TOOLS) {
      expect(tool.requiredCapability).toBe("computerUse");
      expect(tool.source).toBe("evir-local");
    }
    expect(TOOL_BY_ID.get("computer_screenshot")?.riskLevel).toBe("L1");
    expect(TOOL_BY_ID.get("computer_frontmost_app")?.riskLevel).toBe("L1");
    // Synthetic input leaves any sandbox: it must trigger the approval flow.
    for (const id of ["computer_click", "computer_type", "computer_key"]) {
      expect(TOOL_BY_ID.get(id)?.riskLevel).toBe("L3");
    }
  });

  it("stays unavailable on web and on desktop runtimes without the capability", async () => {
    const screenshot = TOOL_BY_ID.get("computer_screenshot");
    if (!screenshot) throw new Error("missing computer_screenshot");

    const web = await screenshot.execute({}, runtimeFor("web", ["chat"]));
    expect(web.success).toBe(false);
    expect(web.error).toBe(TOOL_NOT_AVAILABLE);
    expect(invokeMock).not.toHaveBeenCalled();

    const noCapability = await screenshot.execute(
      {},
      runtimeFor("desktop", ["chat", "browserAutomation"]),
    );
    expect(noCapability.success).toBe(false);
    expect(noCapability.error).toBe(TOOL_NOT_AVAILABLE);
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("passes parsed arguments to the desktop command and compacts the result", async () => {
    invokeMock.mockResolvedValue({ path: "/tmp/shot.png", width: 1920, height: 1080 });
    const click = TOOL_BY_ID.get("computer_click");
    if (!click) throw new Error("missing computer_click");

    const result = await click.execute({ x: 120, y: 340 }, desktopRuntime());

    expect(invokeMock).toHaveBeenCalledWith("computer_click", { x: 120, y: 340 });
    expect(result).toEqual({
      success: true,
      output: JSON.stringify({ path: "/tmp/shot.png", width: 1920, height: 1080 }),
    });
  });

  it("rejects malformed arguments before reaching the desktop", async () => {
    const click = TOOL_BY_ID.get("computer_click");
    const type = TOOL_BY_ID.get("computer_type");
    const key = TOOL_BY_ID.get("computer_key");
    if (!click || !type || !key) throw new Error("missing computer tools");

    const outOfRange = await click.execute({ x: 99_999, y: 10 }, desktopRuntime());
    expect(outOfRange.success).toBe(false);
    expect(outOfRange.error).toBe("invalid_args");

    const empty = await type.execute({ text: "" }, desktopRuntime());
    expect(empty.success).toBe(false);
    expect(empty.error).toBe("invalid_args");

    const badModifier = await key.execute(
      { key: "return", modifiers: ["hyper"] },
      desktopRuntime(),
    );
    expect(badModifier.success).toBe(false);
    expect(badModifier.error).toBe("invalid_args");

    const unknownArgs = await TOOL_BY_ID.get("computer_screenshot")?.execute(
      { region: "full" },
      desktopRuntime(),
    );
    expect(unknownArgs?.success).toBe(false);
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("reports desktop-side failures (permissions, unsupported platform) as tool errors", async () => {
    invokeMock.mockRejectedValue(
      new Error(
        "osascript failed (exit Some(1)); Accessibility permission is required for synthetic input",
      ),
    );
    const key = TOOL_BY_ID.get("computer_key");
    if (!key) throw new Error("missing computer_key");

    const result = await key.execute({ key: "Escape" }, desktopRuntime());

    expect(result.success).toBe(false);
    expect(result.error).toBe("computer_error");
    expect(result.output).toContain("Accessibility permission is required");
  });

  it("honours abort signals without invoking the desktop", async () => {
    const controller = new AbortController();
    controller.abort();
    const screenshot = TOOL_BY_ID.get("computer_screenshot");
    if (!screenshot) throw new Error("missing computer_screenshot");

    const result = await screenshot.execute({}, desktopRuntime(), controller.signal);

    expect(result).toEqual({ success: false, output: "Aborted", error: "aborted" });
    expect(invokeMock).not.toHaveBeenCalled();
  });
});
