// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProjectRecord } from "../../../core/storage/db";
import { db } from "../../../core/storage/db";

vi.mock("../../../runtime/use-runtime", () => ({
  getRuntime: () => ({ target: "desktop", capabilities: new Set(), has: () => false }),
}));

import { useProjectStore } from "../project-store";
import { clearToolGrants, grantedToolsForProject, grantToolForProject } from "../tool-grants";
import { permissionContextForRunWithGrants, projectIdForRoot } from "../run-permission";

const PROJECT: ProjectRecord = {
  id: "p1",
  displayName: "Evir",
  nameIsCustom: true,
  rootPath: "/tmp/evir",
  canonicalRootPath: "/tmp/evir",
  permissionProfile: "ask",
  additionalAccessRoots: [],
  createdAt: 1,
  updatedAt: 1,
  lastOpenedAt: 1,
};

beforeEach(async () => {
  await Promise.all(db.tables.map((table) => table.clear()));
  useProjectStore.setState({
    projects: [{ ...PROJECT }],
    currentProjectId: "p1",
    loaded: true,
    folderMissing: {},
  });
});

describe("scoped tool grants", () => {
  it("persists a per-project grant and resolves it for the matching root", async () => {
    expect(projectIdForRoot("/tmp/evir")).toBe("p1");
    expect(await grantedToolsForProject("p1")).toEqual(new Set());
    const projectId = await grantToolForProject("p1", "apply_patch");
    expect(projectId).toBe("p1");
    expect(await grantedToolsForProject("p1")).toEqual(new Set(["apply_patch"]));
    // A different project does not see the grant.
    expect(await grantedToolsForProject("p2")).toEqual(new Set());
  });

  it("an unbound root resolves to no project", () => {
    expect(projectIdForRoot("/tmp/unknown-root")).toBeNull();
    expect(projectIdForRoot(null)).toBeNull();
  });

  it("clears grants when the project's permission profile changes", async () => {
    await grantToolForProject("p1", "apply_patch");
    await useProjectStore.getState().setPermissionProfile("p1", "workspace");
    expect(await grantedToolsForProject("p1")).toEqual(new Set());
  });

  it("arms the run permission context with the project's grants", async () => {
    await grantToolForProject("p1", "run_command");
    const context = await permissionContextForRunWithGrants("/tmp/evir");
    expect(context).toMatchObject({ profile: "ask" });
    expect(context?.grantedTools).toEqual(new Set(["run_command"]));
  });

  it("clearToolGrants is a no-op for projects without grants", async () => {
    await expect(clearToolGrants("missing")).resolves.toBeUndefined();
  });
});
