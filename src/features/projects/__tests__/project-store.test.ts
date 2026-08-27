// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProjectRecord } from "../../../core/storage/db";
import { db } from "../../../core/storage/db";
import { getStructuredStorage } from "../../../runtime/structured-storage";

vi.mock("../../../runtime/use-runtime", () => ({
  getRuntime: () => ({
    target: "desktop",
    capabilities: new Set(["filesystem"]),
    has: () => true,
    storage: {
      realPath: vi.fn((path: string) =>
        path.includes("missing") || path.includes("gone")
          ? Promise.reject(new Error("not found"))
          : Promise.resolve(path === "/tmp/proj" ? "/private/tmp/proj" : path),
      ),
    },
  }),
}));

import { useProjectStore } from "../project-store";
import { useChatStore } from "../../chat/chat-store";

beforeEach(async () => {
  await Promise.all(db.tables.map((table) => table.clear()));
  useProjectStore.setState({
    projects: [],
    currentProjectId: null,
    loaded: false,
    folderMissing: {},
  });
  useChatStore.setState({ conversations: [], currentConversationId: null });
});

describe("project store", () => {
  it("creates a project with canonical path, default name, and selects it", async () => {
    const result = await useProjectStore.getState().addProject("/tmp/proj");

    expect(result.project).toMatchObject({
      displayName: "proj",
      nameIsCustom: false,
      canonicalRootPath: "/private/tmp/proj",
      permissionProfile: "ask",
      additionalAccessRoots: [],
    });
    expect(useProjectStore.getState().currentProjectId).toBe(result.project!.id);
    const persisted = await db.projects.get(result.project!.id);
    expect(persisted?.canonicalRootPath).toBe("/private/tmp/proj");
  });

  it("rejects a missing folder without creating anything", async () => {
    const result = await useProjectStore.getState().addProject("/tmp/missing-folder");

    expect(result.error).toBe("folder-missing");
    expect(useProjectStore.getState().projects).toHaveLength(0);
  });

  it("reopens the existing project instead of duplicating the same canonical path", async () => {
    const first = await useProjectStore.getState().addProject("/tmp/proj");
    // A symlinked or differently-spelled path resolving to the same real folder.
    const second = await useProjectStore.getState().addProject("/private/tmp/proj");

    expect(second.duplicateOf?.id).toBe(first.project!.id);
    expect(useProjectStore.getState().projects).toHaveLength(1);
  });

  it("rebinding keeps the project id, threads, and custom names", async () => {
    const { project } = await useProjectStore.getState().addProject("/tmp/proj");
    await useProjectStore.getState().renameProject(project!.id, "My Evir");
    await getStructuredStorage().write("conversations", "conv-1", {
      id: "conv-1",
      title: "重构 Sidebar",
      providerId: "p",
      modelId: "m",
      createdAt: 1,
      updatedAt: 1,
      projectId: project!.id,
    });
    useChatStore.setState({
      conversations: [
        {
          id: "conv-1",
          title: "重构 Sidebar",
          providerId: "p",
          modelId: "m",
          createdAt: 1,
          updatedAt: 1,
          projectId: project!.id,
        },
      ],
    });

    const rebound = await useProjectStore.getState().rebindProject(project!.id, "/tmp/proj-moved");

    expect(rebound.project).toMatchObject({
      id: project!.id,
      rootPath: "/tmp/proj-moved",
      displayName: "My Evir",
      nameIsCustom: true,
    });
    const conversation = await getStructuredStorage().read<{
      projectId?: string | null;
    }>("conversations", "conv-1");
    expect(conversation?.projectId).toBe(project!.id);
  });

  it("rebinding to another project's folder is refused", async () => {
    const a = await useProjectStore.getState().addProject("/tmp/a");
    const b = await useProjectStore.getState().addProject("/tmp/b");
    const result = await useProjectStore.getState().rebindProject(b.project!.id, "/tmp/a");

    expect(result.duplicateOf?.id).toBe(a.project!.id);
    expect(
      useProjectStore.getState().projects.find(({ id }) => id === b.project!.id)?.rootPath,
    ).toBe("/tmp/b");
  });

  it("removing a project unties its threads without deleting them or the project folder data", async () => {
    const { project } = await useProjectStore.getState().addProject("/tmp/proj");
    const conversationRecord = {
      id: "conv-1",
      title: "Thread",
      providerId: "p",
      modelId: "m",
      createdAt: 1,
      updatedAt: 1,
      projectId: project!.id,
    };
    await getStructuredStorage().write("conversations", "conv-1", conversationRecord);
    useChatStore.setState({ conversations: [conversationRecord] });

    await useProjectStore.getState().removeProject(project!.id);

    expect(useProjectStore.getState().projects).toHaveLength(0);
    expect(useProjectStore.getState().currentProjectId).toBeNull();
    const migrated = await getStructuredStorage().read<{
      projectId?: string | null;
      title: string;
    }>("conversations", "conv-1");
    // Thread survives as a standalone chat; only the association is removed.
    expect(migrated?.projectId).toBeNull();
    expect(migrated?.title).toBe("Thread");
    expect(useChatStore.getState().conversations[0]?.projectId).toBeNull();
  });

  it("tracks and clears folder-missing status", async () => {
    const { project } = await useProjectStore.getState().addProject("/tmp/proj");
    await useProjectStore.getState().refreshFolderStatus(project!.id);
    expect(useProjectStore.getState().folderMissing[project!.id]).toBe(false);

    await useProjectStore.getState().rebindProject(project!.id, "/tmp/missing-folder");
    expect(useProjectStore.getState().folderMissing[project!.id]).toBe(false); // rebind refuses

    // Simulate the folder disappearing later: rootPath points at a missing dir.
    useProjectStore.setState({
      projects: [
        {
          ...project!,
          rootPath: "/tmp/gone",
          canonicalRootPath: "/tmp/gone",
        } satisfies ProjectRecord,
      ],
    });
    await useProjectStore.getState().refreshFolderStatus(project!.id);
    expect(useProjectStore.getState().folderMissing[project!.id]).toBe(true);
  });

  it("manages permission profiles and additional access roots with dedupe", async () => {
    const { project } = await useProjectStore.getState().addProject("/tmp/proj");

    await useProjectStore.getState().setPermissionProfile(project!.id, "workspace");
    expect(useProjectStore.getState().projects[0]?.permissionProfile).toBe("workspace");

    expect(await useProjectStore.getState().addAccessRoot(project!.id, "/tmp/extra")).toBe(true);
    expect(await useProjectStore.getState().addAccessRoot(project!.id, "/tmp/extra")).toBe(true);
    expect(await useProjectStore.getState().addAccessRoot(project!.id, "/tmp/proj")).toBe(true);
    expect(useProjectStore.getState().projects[0]?.additionalAccessRoots).toEqual(["/tmp/extra"]);

    await useProjectStore.getState().removeAccessRoot(project!.id, "/tmp/extra");
    expect(useProjectStore.getState().projects[0]?.additionalAccessRoots).toEqual([]);
  });
});
