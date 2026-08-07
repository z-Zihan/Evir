// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SettingsFormDialog } from "../SettingsFormDialog";

afterEach(cleanup);

describe("SettingsFormDialog", () => {
  it("keeps focus inside and returns it to the trigger", () => {
    const trigger = document.createElement("button");
    trigger.textContent = "Open";
    document.body.append(trigger);
    trigger.focus();

    const { unmount } = render(
      <SettingsFormDialog title="Edit" onClose={vi.fn()}>
        <input aria-label="Name" />
        <button type="button">Save</button>
      </SettingsFormDialog>,
    );

    const close = screen.getByRole("button", { name: "Edit" });
    expect(document.activeElement).toBe(close);
    fireEvent.keyDown(window, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Save" }));
    fireEvent.keyDown(window, { key: "Tab" });
    expect(document.activeElement).toBe(close);

    unmount();
    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });

  it("does not steal focus when the parent rerenders with a new close callback", () => {
    const { rerender } = render(
      <SettingsFormDialog title="Edit" onClose={vi.fn()}>
        <input aria-label="Name" />
      </SettingsFormDialog>,
    );
    const input = screen.getByRole("textbox", { name: "Name" });
    input.focus();

    rerender(
      <SettingsFormDialog title="Edit" onClose={vi.fn()}>
        <input aria-label="Name" />
      </SettingsFormDialog>,
    );

    expect(document.activeElement).toBe(input);
  });
});
