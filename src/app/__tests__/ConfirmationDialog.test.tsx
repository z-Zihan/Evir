// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConfirmationDialog } from "../ConfirmationDialog";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ConfirmationDialog", () => {
  it("cancels without executing the destructive action", async () => {
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    render(
      <ConfirmationDialog
        title="Delete?"
        description="This cannot be undone."
        confirmLabel="Delete"
        onCancel={onCancel}
        onConfirm={onConfirm}
      />,
    );

    expect(screen.getByRole("alertdialog")).toBeDefined();
    // Base UI settles initial focus asynchronously after the portal mounts.
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("button", { name: "confirmation.cancel" }),
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "confirmation.cancel" }));
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("executes only after the explicit confirmation", async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    render(
      <ConfirmationDialog
        title="Delete?"
        description="This cannot be undone."
        confirmLabel="Delete"
        onCancel={vi.fn()}
        onConfirm={onConfirm}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(onConfirm).toHaveBeenCalledOnce());
  });

  it("keeps the dialog open and reports a failed action", async () => {
    render(
      <ConfirmationDialog
        title="Delete?"
        description="This cannot be undone."
        confirmLabel="Delete"
        onCancel={vi.fn()}
        onConfirm={vi.fn().mockRejectedValue(new Error("failed"))}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect((await screen.findByRole("alert")).textContent).toBe("confirmation.failed");
    expect(screen.getByRole("alertdialog")).toBeDefined();
  });
});
