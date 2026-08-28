// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

afterEach(cleanup);

describe("ModeSwitcher", () => {
  it("renders nothing for standalone chats (ask-only)", async () => {
    const { ModeSwitcher } = await import("../ModeSwitcher");
    render(
      <ModeSwitcher
        mode="ask"
        onModeChange={vi.fn()}
        projectScoped={false}
        toolCalling
        onConfigureModel={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("keeps Agent implicit and offers only Plan and Goal for project threads", async () => {
    const onModeChange = vi.fn();
    const { ModeSwitcher } = await import("../ModeSwitcher");
    render(
      <ModeSwitcher
        mode="agent"
        onModeChange={onModeChange}
        projectScoped
        toolCalling
        onConfigureModel={vi.fn()}
      />,
    );

    expect(screen.queryByRole("button", { name: /chat\.modes\.agent/ })).toBeNull();
    expect(screen.getByRole("button", { name: /chat\.modes\.plan/ })).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: /chat\.modes\.goal/ }));
    expect(onModeChange).toHaveBeenCalledWith("goal");
  });

  it("returns an active special mode to the default project task", async () => {
    const onModeChange = vi.fn();
    const { ModeSwitcher } = await import("../ModeSwitcher");
    render(
      <ModeSwitcher
        mode="plan"
        onModeChange={onModeChange}
        projectScoped
        toolCalling
        onConfigureModel={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /chat\.modes\.plan/ }));
    expect(onModeChange).toHaveBeenCalledWith("agent");
  });

  it("disables the group with an actionable reason when the model lacks tool calling", async () => {
    const onConfigureModel = vi.fn();
    const { ModeSwitcher } = await import("../ModeSwitcher");
    render(
      <ModeSwitcher
        mode="agent"
        onModeChange={vi.fn()}
        projectScoped
        toolCalling={false}
        onConfigureModel={onConfigureModel}
      />,
    );

    expect(screen.getByText("chat.noToolCalling")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "chat.changeModel" }));
    expect(onConfigureModel).toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /chat\.modes\.agent/ })).toBeNull();
  });
});
