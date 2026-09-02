// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SettingsFormDialog } from "../SettingsFormDialog";

afterEach(cleanup);

describe("SettingsFormDialog", () => {
  it("keeps focus inside and returns it to the trigger", async () => {
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

    // Base UI modal: initial focus lands on the dialog's close control, and
    // everything outside the portal becomes inert (the focus trap primitive).
    const close = screen.getByRole("button", { name: "Edit" });
    await waitFor(() => expect(document.activeElement).toBe(close));
    await waitFor(() => expect(trigger.getAttribute("data-base-ui-inert") !== null).toBe(true));

    unmount();
    await waitFor(() => expect(document.activeElement).toBe(trigger));
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

  it("closes immediately when the form is clean", async () => {
    const onClose = vi.fn();
    render(
      <SettingsFormDialog title="Edit" onClose={onClose} dirty={false}>
        <input aria-label="Name" />
      </SettingsFormDialog>,
    );
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  });

  it("asks before discarding unsaved changes and still closes after confirmation", async () => {
    const onClose = vi.fn();
    const { rerender } = render(
      <SettingsFormDialog title="Edit" onClose={onClose} dirty>
        <input aria-label="Name" />
      </SettingsFormDialog>,
    );
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.getByRole("alertdialog")).toBeTruthy());
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.getByRole("alertdialog")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());

    rerender(
      <SettingsFormDialog title="Edit" onClose={onClose} dirty={false}>
        <input aria-label="Name" />
      </SettingsFormDialog>,
    );
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(2));
  });
});
