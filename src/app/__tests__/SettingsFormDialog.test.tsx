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

  it("closes immediately when the form is clean", () => {
    const onClose = vi.fn();
    render(
      <SettingsFormDialog title="Edit" onClose={onClose} dirty={false}>
        <input aria-label="Name" />
      </SettingsFormDialog>,
    );
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("asks before discarding unsaved changes and still closes after confirmation", () => {
    const onClose = vi.fn();
    const { rerender } = render(
      <SettingsFormDialog title="Edit" onClose={onClose} dirty>
        <input aria-label="Name" />
      </SettingsFormDialog>,
    );
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("alertdialog")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));
    expect(onClose).toHaveBeenCalledOnce();

    rerender(
      <SettingsFormDialog title="Edit" onClose={onClose} dirty={false}>
        <input aria-label="Name" />
      </SettingsFormDialog>,
    );
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
