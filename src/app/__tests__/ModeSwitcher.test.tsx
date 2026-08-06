// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RuntimeTarget } from "../../runtime/types";

let runtimeTarget: RuntimeTarget = "web";

vi.mock("../../runtime/use-runtime", () => ({
  getRuntime: () => ({ target: runtimeTarget }),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

afterEach(() => {
  cleanup();
  runtimeTarget = "web";
});

describe("ModeSwitcher", () => {
  it("does not expose desktop modes in the web runtime", async () => {
    const { ModeSwitcher } = await import("../ModeSwitcher");
    render(<ModeSwitcher mode="ask" onModeChange={vi.fn()} />);

    expect(screen.queryByRole("button")).toBeNull();
  });

  it("shows Ask and Agent in the desktop runtime", async () => {
    runtimeTarget = "desktop";
    const onModeChange = vi.fn();
    const { ModeSwitcher } = await import("../ModeSwitcher");
    render(<ModeSwitcher mode="ask" onModeChange={onModeChange} />);

    expect(screen.getByRole("button", { name: "chat.modes.ask" })).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "chat.modes.agent" }));
    expect(onModeChange).toHaveBeenCalledWith("agent");
  });
});
