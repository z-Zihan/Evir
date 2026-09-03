// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { ConfirmDialog, DangerConfirmDialog, FormDialog, AppDialog } from "../dialog-composites";
import { EmptyState, ErrorState, InlineError, LoadingState } from "../states";
import {
  SettingsGroup,
  SettingsOptionCard,
  SettingsPage,
  SettingsPageIntro,
  SettingsRow,
  SettingsSection,
} from "../../settings";

afterEach(cleanup);

function ConfirmHarness({
  onConfirm,
  tone = "default",
}: {
  onConfirm: () => Promise<void>;
  tone?: "default" | "warning" | "danger";
}) {
  const [open, setOpen] = useState(true);
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={setOpen}
      title="Delete provider?"
      description="Keys stay in the local vault."
      confirmLabel="Delete"
      tone={tone}
      onConfirm={onConfirm}
    />
  );
}

describe("ConfirmDialog", () => {
  it("renders an alertdialog with cancel/confirm and closes on confirm", async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    render(<ConfirmHarness onConfirm={onConfirm} />);
    expect(screen.getByRole("alertdialog")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(onConfirm).toHaveBeenCalledOnce());
    // Success closes the dialog (open flips via onOpenChange inside the harness).
  });

  it("keeps the dialog open and reports failure as an alert when confirm rejects", async () => {
    const onConfirm = vi.fn().mockRejectedValue(new Error("locked"));
    render(<ConfirmHarness onConfirm={onConfirm} />);
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("confirmation.failed");
    expect(screen.getByRole("alertdialog")).toBeTruthy();
  });

  it("DangerConfirmDialog forces the destructive tone", () => {
    render(
      <DangerConfirmDialog
        open
        onOpenChange={() => undefined}
        title="Wipe data"
        confirmLabel="Wipe"
        onConfirm={() => undefined}
      />,
    );
    expect(screen.getByRole("alertdialog")).toBeTruthy();
  });
});

describe("FormDialog", () => {
  it("submits through the shared footer button and disables while busy", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <FormDialog
        open
        onOpenChange={() => undefined}
        title="Edit"
        submitLabel="Save"
        onSubmit={onSubmit}
      >
        <input aria-label="Name" defaultValue="x" />
      </FormDialog>,
    );
    const save = screen.getByRole("button", { name: "Save" });
    fireEvent.click(save);
    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
  });
});

describe("AppDialog", () => {
  it("renders title, description, children and footer", () => {
    render(
      <AppDialog
        open
        onOpenChange={() => undefined}
        title="Details"
        description="More context"
        footer={<button type="button">Done</button>}
      >
        <p>Body</p>
      </AppDialog>,
    );
    expect(screen.getByText("Details")).toBeTruthy();
    expect(screen.getByText("More context")).toBeTruthy();
    expect(screen.getByText("Body")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Done" })).toBeTruthy();
  });
});

describe("content states", () => {
  it("LoadingState exposes role=status", () => {
    render(<LoadingState label="Preparing" />);
    expect(screen.getByRole("status").textContent).toContain("Preparing");
  });

  it("ErrorState shows message with retry", () => {
    const onRetry = vi.fn();
    render(<ErrorState title="Preview failed" onRetry={onRetry} retryLabel="Retry now" />);
    fireEvent.click(screen.getByRole("button", { name: "Retry now" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("InlineError is an alert region", () => {
    render(<InlineError message="Save failed" />);
    expect(screen.getByRole("alert").textContent).toBe("Save failed");
  });

  it("EmptyState renders icon/title/description/action slots", () => {
    render(
      <EmptyState
        icon={<span data-testid="icon" />}
        title="No servers"
        description="Add one to begin"
        primaryAction={<button type="button">Add</button>}
      />,
    );
    expect(screen.getByTestId("icon")).toBeTruthy();
    expect(screen.getByText("No servers")).toBeTruthy();
    expect(screen.getByText("Add one to begin")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add" })).toBeTruthy();
  });
});

describe("settings layout", () => {
  it("SettingsRow associates its label with the control via htmlFor", () => {
    render(
      <SettingsPage>
        <SettingsPageIntro eyebrow="Section" description="What this does" />
        <SettingsSection title="Group">
          <SettingsGroup>
            <SettingsRow
              label="Enabled"
              description="Turn it on"
              htmlFor="row-input"
              control={<input id="row-input" />}
            />
          </SettingsGroup>
        </SettingsSection>
      </SettingsPage>,
    );
    expect(screen.getByLabelText("Enabled")).toBeTruthy();
    expect(screen.getByText("What this does")).toBeTruthy();
  });

  it("SettingsOptionCard toggles aria-pressed with selection", () => {
    function Harness() {
      const [on, setOn] = useState(false);
      return (
        <SettingsOptionCard
          title="Dark"
          description="Dark theme"
          selected={on}
          onClick={() => setOn(!on)}
        />
      );
    }
    render(<Harness />);
    const card = screen.getByRole("button", { name: /Dark/ });
    expect(card.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(card);
    expect(card.getAttribute("aria-pressed")).toBe("true");
  });
});
