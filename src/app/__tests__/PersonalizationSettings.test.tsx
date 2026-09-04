// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_PERSONALIZATION_PREFERENCES } from "../../core/personalization/types";

vi.mock("../../features/settings/personalization-settings", () => ({
  loadPersonalizationPreferences: vi
    .fn()
    .mockResolvedValue({ ...DEFAULT_PERSONALIZATION_PREFERENCES }),
  savePersonalizationPreferences: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../AvatarCropDialog", () => ({
  AvatarCropDialog: ({ onSave }: { onSave: (image: string) => void }) => (
    <div role="dialog" aria-label="crop-dialog">
      <button type="button" onClick={() => onSave("data:image/jpeg;base64,cropped")}>
        finish-crop
      </button>
    </div>
  ),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  Reflect.deleteProperty(URL, "createObjectURL");
  Reflect.deleteProperty(URL, "revokeObjectURL");
});

describe("PersonalizationPanel", () => {
  it("requires confirmation before restoring defaults", async () => {
    const settings = await import("../../features/settings/personalization-settings");
    const savePreferences = vi.mocked(settings.savePersonalizationPreferences);
    const { PersonalizationPanel } = await import("../PersonalizationSettings");
    render(<PersonalizationPanel />);
    await screen.findByText("personalization.responseLanguage");

    fireEvent.click(screen.getByRole("button", { name: "personalization.reset" }));
    expect(screen.getByRole("alertdialog")).toBeDefined();
    expect(savePreferences).not.toHaveBeenCalled();
    fireEvent.click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: "personalization.reset",
      }),
    );

    await waitFor(() => expect(savePreferences).toHaveBeenCalledOnce());
  });

  it("preserves the latest local identity when saving response preferences", async () => {
    const settings = await import("../../features/settings/personalization-settings");
    const loadPreferences = vi.mocked(settings.loadPersonalizationPreferences);
    const savePreferences = vi.mocked(settings.savePersonalizationPreferences);
    loadPreferences
      .mockResolvedValueOnce({ ...DEFAULT_PERSONALIZATION_PREFERENCES })
      .mockResolvedValueOnce({
        ...DEFAULT_PERSONALIZATION_PREFERENCES,
        displayName: "刚更新的昵称",
        avatarImage: "data:image/jpeg;base64,new-avatar",
      });

    const { PersonalizationPanel } = await import("../PersonalizationSettings");
    render(<PersonalizationPanel />);
    await screen.findByText("personalization.responseLanguage");
    fireEvent.click(screen.getByRole("button", { name: "personalization.save" }));

    await waitFor(() =>
      expect(savePreferences).toHaveBeenCalledWith(
        expect.objectContaining({
          displayName: "刚更新的昵称",
          avatarImage: "data:image/jpeg;base64,new-avatar",
        }),
      ),
    );
  });
});
