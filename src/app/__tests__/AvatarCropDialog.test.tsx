// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AvatarCropDialog } from "../AvatarCropDialog";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("react-easy-crop", () => ({
  default: () => <div data-testid="cropper" />,
}));

vi.mock("../avatar-image", () => ({
  cropAvatarImage: vi.fn(),
}));

afterEach(cleanup);

describe("AvatarCropDialog", () => {
  it("traps focus, closes with Escape, and returns focus to the trigger", async () => {
    const trigger = document.createElement("button");
    trigger.textContent = "Choose photo";
    document.body.append(trigger);
    trigger.focus();
    const onCancel = vi.fn();

    const { unmount } = render(
      <AvatarCropDialog imageUrl="blob:avatar" onCancel={onCancel} onSave={vi.fn()} />,
    );

    const close = screen.getByRole("button", { name: "personalization.closeCrop" });
    await waitFor(() => expect(document.activeElement).toBe(close));
    // Outside content is inert while the modal is open (Base UI focus trap).
    await waitFor(() => expect(trigger.getAttribute("data-base-ui-inert") !== null).toBe(true));

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(onCancel).toHaveBeenCalledOnce());
    unmount();
    await waitFor(() => expect(document.activeElement).toBe(trigger));
    trigger.remove();
  });

  it("does not steal focus when the parent rerenders with a new cancel callback", () => {
    const { rerender } = render(
      <AvatarCropDialog imageUrl="blob:avatar" onCancel={vi.fn()} onSave={vi.fn()} />,
    );
    const zoom = screen.getByRole("slider", { name: "personalization.zoom" });
    zoom.focus();

    rerender(<AvatarCropDialog imageUrl="blob:avatar" onCancel={vi.fn()} onSave={vi.fn()} />);

    expect(document.activeElement).toBe(zoom);
  });
});
