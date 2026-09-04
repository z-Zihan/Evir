// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();

vi.mock("../../../runtime/tauri-ipc", () => ({
  tauriInvoke: (command: string, args?: Record<string, unknown>): Promise<unknown> =>
    invokeMock(command, args) as Promise<unknown>,
}));

import {
  EGO_UNSUPPORTED_COMMANDS,
  egoTaskSpaceName,
  invokeAgentBrowserCommand,
  readAgentBrowserProvider,
  writeAgentBrowserProvider,
} from "../browser-provider";
import { setActiveProfileIdSync } from "../../../core/profile/profile-scope";

const PROVIDER_KEY = "browser.agentProvider";

function setProviderRaw(value: string | null) {
  if (value === null) {
    window.localStorage.removeItem(`${PROVIDER_KEY}::default`);
  } else {
    window.localStorage.setItem(`${PROVIDER_KEY}::default`, value);
  }
}

describe("agent browser provider", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    setProviderRaw(null);
    window.localStorage.removeItem("browser.agentProvider");
    window.localStorage.removeItem("evir:active-profile");
  });

  it("defaults to the evir provider and passes commands through unchanged", async () => {
    setProviderRaw(null);
    invokeMock.mockResolvedValue({ url: "https://example.com" });
    const result = await invokeAgentBrowserCommand("browser_navigate", {
      url: "https://example.com",
    });
    expect(result).toEqual({ url: "https://example.com" });
    expect(invokeMock).toHaveBeenCalledWith("browser_navigate", {
      url: "https://example.com",
    });
  });

  it("routes commands to ego_browser_run with mapped op and params when ego-lite is active", async () => {
    setProviderRaw("ego-lite");
    invokeMock.mockResolvedValue({ clicked: "@3" });
    await invokeAgentBrowserCommand("browser_click", { element_ref: "@3" });
    expect(invokeMock).toHaveBeenCalledWith("ego_browser_run", {
      op: "click",
      params: { ref: "@3" },
      space: "evir-default",
    });

    invokeMock.mockResolvedValue({ filled: "@4" });
    await invokeAgentBrowserCommand("browser_fill", { element_ref: "@4", text: "hi" });
    expect(invokeMock).toHaveBeenLastCalledWith("ego_browser_run", {
      op: "fill",
      params: { ref: "@4", text: "hi" },
      space: "evir-default",
    });

    await invokeAgentBrowserCommand("browser_wait", { ms: 250 });
    expect(invokeMock).toHaveBeenLastCalledWith("ego_browser_run", {
      op: "wait",
      params: { ms: 250 },
      space: "evir-default",
    });
  });

  it("rejects commands without an ego mapping explicitly", async () => {
    setProviderRaw("ego-lite");
    for (const command of EGO_UNSUPPORTED_COMMANDS) {
      await expect(invokeAgentBrowserCommand(command, {})).rejects.toThrow(/not supported/i);
    }
    await expect(invokeAgentBrowserCommand("browser_wait_for_load", {})).rejects.toThrow(
      /no Ego Lite provider mapping/i,
    );
  });

  it("names the ego task space after the active profile", () => {
    expect(egoTaskSpaceName()).toBe("evir-default");
    setActiveProfileIdSync("u1234");
    expect(egoTaskSpaceName()).toBe("evir-u1234");
    setActiveProfileIdSync("bad/id spaces!");
    expect(egoTaskSpaceName()).toBe("evir-bad-id-spaces-");
    setActiveProfileIdSync("default");
  });

  it("reads and writes the provider preference profile-scoped", () => {
    expect(readAgentBrowserProvider()).toBe("evir");
    writeAgentBrowserProvider("ego-lite");
    expect(readAgentBrowserProvider()).toBe("ego-lite");
    expect(window.localStorage.getItem(`${PROVIDER_KEY}::default`)).toBe("ego-lite");

    // A different profile does not inherit the preference.
    setActiveProfileIdSync("u5678");
    expect(readAgentBrowserProvider()).toBe("evir");
    writeAgentBrowserProvider("ego-lite");
    expect(window.localStorage.getItem(`${PROVIDER_KEY}::u5678`)).toBe("ego-lite");
    expect(window.localStorage.getItem(`${PROVIDER_KEY}::default`)).toBe("ego-lite");
    setActiveProfileIdSync("default");
  });

  it("ignores invalid stored values", () => {
    setProviderRaw("chromium-forever");
    expect(readAgentBrowserProvider()).toBe("evir");
  });
});
