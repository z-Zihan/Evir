// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProjectRecord } from "../../core/storage/db";
import { ProjectPermissionPanel } from "../ProjectPermissionPanel";

const setPermissionProfile = vi.fn();

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("../../features/projects/project-store", () => ({
  useProjectStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      setPermissionProfile,
      addAccessRoot: vi.fn(),
      removeAccessRoot: vi.fn(),
    }),
}));

vi.mock("../../runtime/use-runtime", () => ({ getRuntime: () => ({ target: "desktop" }) }));

const project: ProjectRecord = {
  id: "project-1",
  displayName: "Evir",
  nameIsCustom: false,
  rootPath: "/projects/evir",
  canonicalRootPath: "/projects/evir",
  permissionProfile: "ask",
  additionalAccessRoots: [],
  createdAt: 1,
  updatedAt: 1,
  lastOpenedAt: 1,
};

afterEach(() => {
  cleanup();
  setPermissionProfile.mockReset();
});

describe("ProjectPermissionPanel", () => {
  it("shows all three permission profiles and applies workspace access directly", () => {
    render(<ProjectPermissionPanel project={project} onClose={vi.fn()} />);

    expect(screen.getByText("project.permission.ask")).toBeTruthy();
    expect(screen.getByText("project.permission.workspace")).toBeTruthy();
    expect(screen.getByText("project.permission.full")).toBeTruthy();
    fireEvent.click(screen.getByText("project.permission.workspace"));
    expect(setPermissionProfile).toHaveBeenCalledWith(project.id, "workspace");
  });

  it("requires explicit confirmation before enabling full access", () => {
    render(<ProjectPermissionPanel project={project} onClose={vi.fn()} />);

    fireEvent.click(screen.getByText("project.permission.full"));
    expect(setPermissionProfile).not.toHaveBeenCalled();
    expect(screen.getByRole("alertdialog", { name: "project.fullAccessTitle" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "project.fullAccessConfirm" }));
    expect(setPermissionProfile).toHaveBeenCalledWith(project.id, "full");
  });

  it("closes with Escape", () => {
    const onClose = vi.fn();
    render(<ProjectPermissionPanel project={project} onClose={onClose} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
