// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProjectRecord } from "../../../core/storage/db";
import { db } from "../../../core/storage/db";
import { getStructuredStorage } from "../../../runtime/structured-storage";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { exists: () => false },
  }),
}));

vi.mock("../../../runtime/use-runtime", () => ({
  getRuntime: () => ({ target: "desktop", capabilities: new Set(), has: () => false }),
}));

import { useProjectStore } from "../../../features/projects/project-store";
import { PermissionOnboardingBanner } from "../PermissionOnboardingBanner";

const PROJECT: ProjectRecord = {
  id: "p1",
  displayName: "Evir",
  nameIsCustom: true,
  rootPath: "/tmp/p",
  canonicalRootPath: "/tmp/p",
  permissionProfile: "ask",
  additionalAccessRoots: [],
  createdAt: 1,
  updatedAt: 1,
  lastOpenedAt: 1,
};

async function readOnboarded(): Promise<string[]> {
  const record = await getStructuredStorage()
    .read<{ name: string; value: unknown }>("settings", "permission_onboarding_done")
    .catch(() => undefined);
  const value = record?.value;
  return Array.isArray(value) ? (value as string[]) : [];
}

async function renderBanner() {
  const view = render(<PermissionOnboardingBanner project={{ ...PROJECT }} />);
  await screen.findByRole("heading", { name: "permission.onboardingTitle" });
  return view;
}

afterEach(cleanup);
beforeEach(async () => {
  await Promise.all(db.tables.map((table) => table.clear()));
  useProjectStore.setState({
    projects: [{ ...PROJECT }],
    currentProjectId: "p1",
    loaded: true,
    folderMissing: {},
  });
});

describe("PermissionOnboardingBanner", () => {
  it("shows on first open and records workspace only on the explicit choice", async () => {
    await renderBanner();

    fireEvent.click(screen.getByRole("button", { name: /permission.onboardingWorkspace/ }));

    await waitFor(() => {
      expect(useProjectStore.getState().projects[0]?.permissionProfile).toBe("workspace");
    });
    await waitFor(async () => {
      expect(await readOnboarded()).toContain("p1");
    });

    // Once onboarded, a remount must not show the banner again.
    cleanup();
    const { container } = render(<PermissionOnboardingBanner project={{ ...PROJECT }} />);
    await waitFor(() => {
      expect(container.querySelector(".permission-onboarding")).toBeNull();
    });
  });

  it("records the ask choice as an explicit onboarding decision too", async () => {
    await renderBanner();

    fireEvent.click(screen.getByRole("button", { name: "permission.onboardingAsk" }));

    await waitFor(async () => {
      expect(useProjectStore.getState().projects[0]?.permissionProfile).toBe("ask");
      expect(await readOnboarded()).toContain("p1");
    });
  });

  it("X only postpones: no profile write, no done record, banner returns next time", async () => {
    const { container } = await renderBanner();

    fireEvent.click(screen.getByRole("button", { name: "permission.onboardingDismiss" }));

    await waitFor(() => {
      expect(container.querySelector(".permission-onboarding")).toBeNull();
    });
    // Nothing was persisted: neither the profile nor the done record.
    expect(useProjectStore.getState().projects[0]?.permissionProfile).toBe("ask");
    expect(await readOnboarded()).toEqual([]);

    // Next visit: the banner asks again.
    cleanup();
    render(<PermissionOnboardingBanner project={{ ...PROJECT }} />);
    await screen.findByRole("heading", { name: "permission.onboardingTitle" });
  });
});
