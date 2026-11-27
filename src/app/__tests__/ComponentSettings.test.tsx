// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const readMock = vi.fn();
const writeMock = vi.fn();
const reconcileMock = vi.fn(() => ({
  activated: [],
  deactivated: [],
  reloaded: [],
  unchanged: [],
}));

vi.mock("../../runtime/structured-storage", () => ({
  getStructuredStorage: () => ({ read: readMock, write: writeMock }),
}));

vi.mock("../../runtime/use-runtime", () => ({
  getRuntime: () => ({
    target: "desktop",
    capabilities: new Set(["chat"]),
    has: () => false,
    componentRuntime: {
      inspect: () => [
        {
          id: "evir.tools.computer-use",
          version: "1.0.0",
          kind: "tool",
          state: "disabled",
          provides: [],
          requires: [],
          missingDependencies: [],
        },
        {
          id: "evir.tools.filesystem",
          version: "1.0.0",
          kind: "tool",
          state: "active",
          provides: [],
          requires: [],
          missingDependencies: [],
        },
      ],
      reconcile: reconcileMock,
    },
  }),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

beforeEach(() => {
  readMock.mockReset();
  writeMock.mockReset();
  reconcileMock.mockClear();
  writeMock.mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
});

describe("ComponentSettings", () => {
  it("shows the stored switch state and the default for untouched components", async () => {
    readMock.mockResolvedValue({
      name: "componentConfiguration",
      value: { "evir.tools.computer-use": { enabled: true } },
    });
    const { ComponentSettings } = await import("../ComponentSettings");
    render(<ComponentSettings />);

    const computer = await screen.findByRole("switch", { name: "evir.tools.computer-use" });
    expect(computer.getAttribute("aria-checked")).toBe("true");
    // Not in the stored map → falls back to the component's current state.
    expect(
      screen.getByRole("switch", { name: "evir.tools.filesystem" }).getAttribute("aria-checked"),
    ).toBe("true");
  });

  it("persists a toggle and reconciles the runtime immediately", async () => {
    readMock.mockResolvedValue(undefined);
    const { ComponentSettings } = await import("../ComponentSettings");
    render(<ComponentSettings />);

    fireEvent.click(await screen.findByRole("switch", { name: "evir.tools.computer-use" }));

    await waitFor(() => expect(writeMock).toHaveBeenCalled());
    expect(writeMock).toHaveBeenCalledWith("settings", "componentConfiguration", {
      name: "componentConfiguration",
      value: { "evir.tools.computer-use": { enabled: true } },
    });
    expect(reconcileMock).toHaveBeenCalledWith({
      "evir.tools.computer-use": { enabled: true },
    });
  });
});
