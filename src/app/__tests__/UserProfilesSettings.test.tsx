// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const profileStoreState = vi.hoisted(() => ({
  snapshot: {
    profiles: [
      { id: "default", displayName: "User", createdAt: 1, lastActiveAt: 1 },
      { id: "u2", displayName: "Second", createdAt: 2, lastActiveAt: 2 },
    ],
    activeProfileId: "default",
  },
}));
const createProfile = vi.fn();
const updateProfile = vi.fn();
const removeProfile = vi.fn();
const activateProfile = vi.fn();
const listProfiles = vi.fn(() => Promise.resolve(profileStoreState.snapshot));
const reloadMock = vi.fn();

vi.mock("../../features/profiles/profile-service", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../features/profiles/profile-service")>();
  return {
    ...original,
    useProfileStore: (selector: (state: unknown) => unknown) =>
      selector({
        snapshot: profileStoreState.snapshot,
        list: listProfiles,
        create: createProfile,
        update: updateProfile,
        remove: removeProfile,
        activate: activateProfile,
      }),
  };
});

const chatState = vi.hoisted(() => ({
  streamSlots: {},
  pendingApprovals: {},
  stopGeneration: vi.fn(),
}));

vi.mock("../../features/chat/chat-store", () => ({
  useChatStore: {
    getState: () => chatState,
  },
}));

vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty", init: vi.fn() },
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      if (!options) return key;
      return Object.entries(options).reduce(
        (text, [name, value]) => text.replace(`{{${name}}}`, String(value)),
        key,
      );
    },
  }),
}));

import { UserProfilesPanel } from "../UserProfilesSettings";

beforeEach(() => {
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { ...window.location, reload: reloadMock },
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  chatState.streamSlots = {};
  chatState.pendingApprovals = {};
});

describe("UserProfilesPanel", () => {
  it("lists all users with the active one marked", async () => {
    render(<UserProfilesPanel />);
    await waitFor(() => expect(screen.getByText("Second")).toBeTruthy());
    expect(screen.getByText("users.currentUser")).toBeTruthy();
    expect(screen.getByText("User")).toBeTruthy();
  });

  it("creates a user through the add dialog and switches by default", async () => {
    createProfile.mockResolvedValue({
      id: "u3",
      displayName: "Third",
      createdAt: 3,
      lastActiveAt: 3,
    });
    render(<UserProfilesPanel />);
    fireEvent.click(await screen.findByRole("button", { name: "users.add" }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Third" } });
    fireEvent.click(screen.getByRole("button", { name: "users.create" }));

    await waitFor(() => expect(createProfile).toHaveBeenCalledWith("Third"));
    await waitFor(() => expect(activateProfile).toHaveBeenCalledWith("u3"));
    await waitFor(() => expect(reloadMock).toHaveBeenCalled());
  });

  it("stops running tasks and cancels approvals before switching (confirmed)", async () => {
    chatState.streamSlots = { "conv-1": { phase: "streaming" } };
    chatState.pendingApprovals = { "conv-2": {} };
    activateProfile.mockResolvedValue(undefined);

    render(<UserProfilesPanel />);
    fireEvent.click(await screen.findByRole("button", { name: "users.switch" }));

    // Confirmation spells out what will be stopped (§58) — the raw-key t
    // mock keeps the key text; interpolation is exercised at runtime.
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog.textContent).toContain("users.switchConfirmDescription");
    fireEvent.click(withinText(dialog, "users.stopAndSwitch"));

    await waitFor(() => expect(chatState.stopGeneration).toHaveBeenCalledWith("conv-1"));
    expect(chatState.stopGeneration).toHaveBeenCalledWith("conv-2");
    await waitFor(() => expect(activateProfile).toHaveBeenCalledWith("u2"));
    await waitFor(() => expect(reloadMock).toHaveBeenCalled());
  });

  it("switches without confirmation when nothing is active", async () => {
    activateProfile.mockResolvedValue(undefined);
    render(<UserProfilesPanel />);
    fireEvent.click(await screen.findByRole("button", { name: "users.switch" }));

    await waitFor(() => expect(activateProfile).toHaveBeenCalledWith("u2"));
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("renames a user via the rename dialog", async () => {
    updateProfile.mockResolvedValue(undefined);
    render(<UserProfilesPanel />);
    const renameButtons = await screen.findAllByRole("button", { name: "users.rename" });
    fireEvent.click(renameButtons[0]!);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Renamed" } });
    fireEvent.click(screen.getByRole("button", { name: "users.save" }));
    await waitFor(() =>
      expect(updateProfile).toHaveBeenCalledWith("default", { displayName: "Renamed" }),
    );
  });

  it("deletes a non-active user through the danger dialog", async () => {
    removeProfile.mockResolvedValue(undefined);
    render(<UserProfilesPanel />);
    fireEvent.click(await screen.findByRole("button", { name: "users.delete" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog.textContent).toContain("users.deleteDescription");
    fireEvent.click(withinText(dialog, "users.deleteConfirm"));
    await waitFor(() => expect(removeProfile).toHaveBeenCalledWith("u2"));
  });
});

function withinText(container: HTMLElement, text: string): HTMLElement {
  const button = [...container.querySelectorAll("button")].find(
    (element) => element.textContent === text,
  );
  if (!button) throw new Error(`button ${text} not found`);
  return button;
}
