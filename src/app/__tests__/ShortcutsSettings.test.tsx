// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { exists: () => false },
  }),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ShortcutsSettings", () => {
  it("renders all 6 wired shortcuts without unimplemented entries", async () => {
    const { ShortcutsSettings } = await import("../ShortcutsSettings");
    render(<ShortcutsSettings />);

    expect(screen.getByText("shortcuts.newConversation")).toBeDefined();
    expect(screen.getByText("shortcuts.openSettings")).toBeDefined();
    expect(screen.getByText("shortcuts.toggleSidebar")).toBeDefined();
    expect(screen.getByText("shortcuts.sendMessage")).toBeDefined();
    expect(screen.getByText("shortcuts.stopCurrentRun")).toBeDefined();
    expect(screen.getByText("shortcuts.shortcutHelp")).toBeDefined();
    // 未实现的快捷键不得出现在展示层
    expect(screen.queryByText("shortcuts.commandPalette")).toBeNull();
    expect(screen.queryByText("shortcuts.openWorkspace")).toBeNull();
  });

  it("formats CmdOrCtrl as ⌘ on Mac", async () => {
    const originalPlatform = Object.getOwnPropertyDescriptor(navigator, "platform");
    Object.defineProperty(navigator, "platform", {
      value: "MacIntel",
      configurable: true,
    });

    try {
      vi.resetModules();
      const { ShortcutsSettings } = await import("../ShortcutsSettings");
      render(<ShortcutsSettings />);
      // CmdOrCtrl+, (open-settings) should be formatted as ⌘ , on Mac
      expect(screen.getByText("\u2318 ,")).toBeDefined();
    } finally {
      if (originalPlatform) {
        Object.defineProperty(navigator, "platform", originalPlatform);
      }
      vi.resetModules();
    }
  });

  it("formats CmdOrCtrl as Ctrl on non-Mac", async () => {
    const originalPlatform = Object.getOwnPropertyDescriptor(navigator, "platform");
    Object.defineProperty(navigator, "platform", {
      value: "Win32",
      configurable: true,
    });

    try {
      vi.resetModules();
      const { ShortcutsSettings } = await import("../ShortcutsSettings");
      render(<ShortcutsSettings />);
      // CmdOrCtrl+, (open-settings) should be formatted as Ctrl+, on non-Mac
      expect(screen.getByText("Ctrl+,")).toBeDefined();
    } finally {
      if (originalPlatform) {
        Object.defineProperty(navigator, "platform", originalPlatform);
      }
      vi.resetModules();
    }
  });

  it("shows coming soon note", async () => {
    const { ShortcutsSettings } = await import("../ShortcutsSettings");
    render(<ShortcutsSettings />);

    expect(screen.getByText("shortcuts.comingSoon")).toBeDefined();
  });
});
