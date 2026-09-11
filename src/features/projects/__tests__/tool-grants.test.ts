// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProjectRecord } from "../../../core/storage/db";
import { db } from "../../../core/storage/db";

vi.mock("../../../runtime/use-runtime", () => ({
  getRuntime: () => ({ target: "desktop", capabilities: new Set(), has: () => false }),
}));

import { useProjectStore } from "../project-store";
import { clearToolGrants, grantedToolsForRoot, grantToolInProject } from "../tool-grants";
import { permissionContextForRunWithGrants } from "../run-permission";

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
    expect(await grantedToolsForRoot("/tmp/evir")).toEqual(new Set());
    const projectId = await grantToolInProject("/tmp/evir", "apply_patch");
    expect(projectId).toBe("p1");
    expect(await grantedToolsForRoot("/tmp/evir")).toEqual(new Set(["apply_patch"]));
    // A different root does not see the grant.
    expect(await grantedToolsForRoot("/tmp/other")).toEqual(new Set());
  });

  it("refuses to persist without a project binding", async () => {
    const projectId = await grantToolInProject("/tmp/unknown-root", "apply_patch");
    expect(projectId).toBeNull();
  });

  it("clears grants when the project's permission profile changes", async () => {
    await grantToolInProject("/tmp/evir", "apply_patch");
    await useProjectStore.getState().setPermissionProfile("p1", "workspace");
    expect(await grantedToolsForRoot("/tmp/evir")).toEqual(new Set());
  });

  it("arms the run permission context with the project's grants", async () => {
    await grantToolInProject("/tmp/evir", "run_command");
    const context = await permissionContextForRunWithGrants("/tmp/evir");
    expect(context).toMatchObject({ profile: "ask" });
    expect(context?.grantedTools).toEqual(new Set(["run_command"]));
  });

  it("clearToolGrants is a no-op for projects without grants", async () => {
    await expect(clearToolGrants("missing")).resolves.toBeUndefined();
  });
});
