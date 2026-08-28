import { create } from "zustand";
import type { ProjectRecord } from "../../core/storage/db";
import { getStructuredStorage } from "../../runtime/structured-storage";
import { getRuntime } from "../../runtime/use-runtime";
import { notifyProjectRemoved } from "./project-events";
import { logger } from "../../core/logging/logger";

const CURRENT_PROJECT_KEY = "evir-project-current";

export interface AddProjectResult {
  project?: ProjectRecord;
  /** Set when the canonical path already belongs to an existing project. */
  duplicateOf?: ProjectRecord;
  error?: "folder-missing" | "not-desktop";
}

function normalizeComparable(path: string): string {
  return path.replace(/\/+$/, "").toLowerCase();
}

function basenameOf(path: string): string {
  const parts = path.replace(/[\\/]+$/, "").split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

/** Resolve a user-chosen folder to its canonical real path; null when missing. */
async function canonicalizeFolder(path: string): Promise<string | null> {
  const runtime = getRuntime();
  if (runtime.target === "desktop" && runtime.storage) {
    try {
      return await runtime.storage.realPath(path);
    } catch {
      return null;
    }
  }
  return null;
}

function readCurrentProjectId(projects: ProjectRecord[]): string | null {
  const stored = localStorage.getItem(CURRENT_PROJECT_KEY);
  if (stored && projects.some((project) => project.id === stored)) return stored;
  return null;
}

function persistSelection(projectId: string | null): void {
  if (projectId === null) localStorage.removeItem(CURRENT_PROJECT_KEY);
  else localStorage.setItem(CURRENT_PROJECT_KEY, projectId);
}

async function writeProject(project: ProjectRecord): Promise<void> {
  await getStructuredStorage().write("projects", project.id, project);
}

interface ProjectStoreState {
  projects: ProjectRecord[];
  currentProjectId: string | null;
  loaded: boolean;
  /** projectId -> folder missing at last check. */
  folderMissing: Record<string, boolean>;

  load: () => Promise<void>;
  addProject: (rootPath: string) => Promise<AddProjectResult>;
  selectProject: (projectId: string | null) => void;
  renameProject: (projectId: string, displayName: string) => Promise<void>;
  togglePinProject: (projectId: string) => Promise<void>;
  rebindProject: (projectId: string, newRootPath: string) => Promise<AddProjectResult>;
  removeProject: (projectId: string) => Promise<void>;
  setPermissionProfile: (
    projectId: string,
    profile: ProjectRecord["permissionProfile"],
  ) => Promise<void>;
  addAccessRoot: (projectId: string, rootPath: string) => Promise<boolean>;
  removeAccessRoot: (projectId: string, rootPath: string) => Promise<void>;
  refreshFolderStatus: (projectId: string) => Promise<void>;
  currentProject: () => ProjectRecord | null;
}

export const useProjectStore = create<ProjectStoreState>((set, get) => ({
  projects: [],
  currentProjectId: null,
  loaded: false,
  folderMissing: {},

  load: async () => {
    const projects = await getStructuredStorage().readAll<ProjectRecord>("projects");
    projects.sort((a, b) => (b.pinned ?? 0) - (a.pinned ?? 0) || b.lastOpenedAt - a.lastOpenedAt);
    const currentProjectId = readCurrentProjectId(projects);
    set({ projects, currentProjectId, loaded: true });
    if (currentProjectId) void get().refreshFolderStatus(currentProjectId);
    logger.debug("runtime", "project.loaded", { projectCount: projects.length });
  },

  addProject: async (rootPath) => {
    const canonical = await canonicalizeFolder(rootPath);
    if (canonical === null) {
      const runtime = getRuntime();
      if (runtime.target !== "desktop") return { error: "not-desktop" };
      return { error: "folder-missing" };
    }
    const existing = get().projects.find(
      (project) =>
        normalizeComparable(project.canonicalRootPath) === normalizeComparable(canonical),
    );
    if (existing) {
      get().selectProject(existing.id);
      logger.info("runtime", "project.duplicate-reopened", { projectId: existing.id });
      return { duplicateOf: existing };
    }
    const now = Date.now();
    const project: ProjectRecord = {
      id: crypto.randomUUID(),
      displayName: basenameOf(canonical),
      nameIsCustom: false,
      rootPath: canonical,
      canonicalRootPath: canonical,
      permissionProfile: "ask",
      additionalAccessRoots: [],
      createdAt: now,
      updatedAt: now,
      lastOpenedAt: now,
    };
    await writeProject(project);
    set((state) => ({ projects: [project, ...state.projects] }));
    get().selectProject(project.id);
    logger.info("runtime", "project.created", { projectId: project.id, nameIsCustom: false });
    return { project };
  },

  selectProject: (projectId) => {
    persistSelection(projectId);
    const now = Date.now();
    set((state) => ({
      currentProjectId: projectId,
      projects: state.projects.map((project) =>
        project.id === projectId ? { ...project, lastOpenedAt: now } : project,
      ),
    }));
    const project = get().projects.find(({ id }) => id === projectId);
    if (project && projectId) {
      void writeProject({ ...project, lastOpenedAt: now });
      void get().refreshFolderStatus(projectId);
    }
  },

  renameProject: async (projectId, displayName) => {
    const project = get().projects.find(({ id }) => id === projectId);
    if (!project || !displayName.trim()) return;
    const updated = {
      ...project,
      displayName: displayName.trim(),
      nameIsCustom: true,
      updatedAt: Date.now(),
    };
    await writeProject(updated);
    set((state) => ({
      projects: state.projects.map((item) => (item.id === projectId ? updated : item)),
    }));
    logger.info("runtime", "project.renamed", { projectId });
  },

  togglePinProject: async (projectId) => {
    const project = get().projects.find(({ id }) => id === projectId);
    if (!project) return;
    const updated: ProjectRecord = {
      ...project,
      ...(project.pinned ? {} : { pinned: Date.now() }),
      updatedAt: Date.now(),
    };
    await writeProject(updated);
    set((state) => ({
      projects: state.projects.map((item) => (item.id === projectId ? updated : item)),
    }));
  },

  rebindProject: async (projectId, newRootPath) => {
    const project = get().projects.find(({ id }) => id === projectId);
    if (!project) return { error: "folder-missing" };
    const canonical = await canonicalizeFolder(newRootPath);
    if (canonical === null) return { error: "folder-missing" };
    const conflict = get().projects.find(
      (item) =>
        item.id !== projectId &&
        normalizeComparable(item.canonicalRootPath) === normalizeComparable(canonical),
    );
    if (conflict) return { duplicateOf: conflict };
    const updated: ProjectRecord = {
      ...project,
      rootPath: canonical,
      canonicalRootPath: canonical,
      // A custom display name survives rebinding; default names follow the folder.
      displayName: project.nameIsCustom ? project.displayName : basenameOf(canonical),
      updatedAt: Date.now(),
    };
    await writeProject(updated);
    set((state) => ({
      projects: state.projects.map((item) => (item.id === projectId ? updated : item)),
      folderMissing: { ...state.folderMissing, [projectId]: false },
    }));
    logger.info("runtime", "project.rebound", { projectId });
    return { project: updated };
  },

  removeProject: async (projectId) => {
    const project = get().projects.find(({ id }) => id === projectId);
    if (!project) return;
    // Untie threads only; never touch the folder on disk and never delete history.
    const owned = (
      await getStructuredStorage().readAll<{
        id: string;
        projectId?: string | null;
        updatedAt: number;
      }>("conversations")
    ).filter((conversation) => conversation.projectId === projectId);
    await getStructuredStorage().apply([
      { type: "delete", entity: "projects", id: projectId },
      ...owned.map((conversation) => ({
        type: "write" as const,
        entity: "conversations" as const,
        id: conversation.id,
        data: { ...conversation, projectId: null, updatedAt: Date.now() },
      })),
    ]);
    // The chat side owns conversation state and detaches its threads via the
    // listener in project-events — importing chat-store here would close a
    // module cycle (chat → send-message → projects → chat).
    notifyProjectRemoved(projectId);
    set((state) => ({
      projects: state.projects.filter(({ id }) => id !== projectId),
      folderMissing: Object.fromEntries(
        Object.entries(state.folderMissing).filter(([id]) => id !== projectId),
      ),
      currentProjectId: state.currentProjectId === projectId ? null : state.currentProjectId,
    }));
    if (get().currentProjectId === null) persistSelection(null);
    logger.info("runtime", "project.removed", { projectId });
  },

  setPermissionProfile: async (projectId, profile) => {
    const project = get().projects.find(({ id }) => id === projectId);
    if (!project || project.permissionProfile === profile) return;
    const updated = { ...project, permissionProfile: profile, updatedAt: Date.now() };
    await writeProject(updated);
    set((state) => ({
      projects: state.projects.map((item) => (item.id === projectId ? updated : item)),
    }));
    logger.info("security", "project.permission-profile-changed", { projectId, profile });
  },

  addAccessRoot: async (projectId, rootPath) => {
    const project = get().projects.find(({ id }) => id === projectId);
    if (!project) return false;
    const canonical = await canonicalizeFolder(rootPath);
    if (canonical === null) return false;
    if (
      normalizeComparable(canonical) === normalizeComparable(project.canonicalRootPath) ||
      project.additionalAccessRoots.some(
        (root) => normalizeComparable(root) === normalizeComparable(canonical),
      )
    ) {
      return true;
    }
    const updated = {
      ...project,
      additionalAccessRoots: [...project.additionalAccessRoots, canonical],
      updatedAt: Date.now(),
    };
    await writeProject(updated);
    set((state) => ({
      projects: state.projects.map((item) => (item.id === projectId ? updated : item)),
    }));
    logger.info("security", "project.access-root-added", { projectId });
    return true;
  },

  removeAccessRoot: async (projectId, rootPath) => {
    const project = get().projects.find(({ id }) => id === projectId);
    if (!project) return;
    const updated = {
      ...project,
      additionalAccessRoots: project.additionalAccessRoots.filter(
        (root) => normalizeComparable(root) !== normalizeComparable(rootPath),
      ),
      updatedAt: Date.now(),
    };
    await writeProject(updated);
    set((state) => ({
      projects: state.projects.map((item) => (item.id === projectId ? updated : item)),
    }));
    logger.info("security", "project.access-root-removed", { projectId });
  },

  refreshFolderStatus: async (projectId) => {
    const project = get().projects.find(({ id }) => id === projectId);
    if (!project) return;
    const exists = (await canonicalizeFolder(project.rootPath)) !== null;
    set((state) => ({
      folderMissing: { ...state.folderMissing, [projectId]: !exists },
    }));
    if (!exists) {
      logger.warn("runtime", "project.folder-missing", { projectId });
    }
  },

  currentProject: () => {
    const { projects, currentProjectId } = get();
    return projects.find(({ id }) => id === currentProjectId) ?? null;
  },
}));
