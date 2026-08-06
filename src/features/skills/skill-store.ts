import { create } from "zustand";
// NOTE: Uses Dexie directly for settings; StoragePort covers basic CRUD
import { db } from "../../core/storage/db";
import type { SkillManifest } from "../../core/skills/types";
import { validateManifest } from "../../core/skills/types";
import { createSkillRegistry, type SkillRegistry } from "../../core/skills/skill-registry";
import type { InstalledSkill } from "../../core/skills/types";

const SKILL_ENABLED_SETTING = "skillEnabledIds";

interface SkillState {
  skills: InstalledSkill[];
  enabledSkillIds: Set<string>;
  loadSkills: () => Promise<void>;
  toggleSkill: (id: string) => Promise<void>;
  isEnabled: (id: string) => boolean;
  getEnabledContent: () => Promise<string>;
  importSkill: (manifest: SkillManifest, content: string) => Promise<string>;
  createSkill: (name: string, description: string, content: string) => Promise<string>;
  installSkill: (manifest: SkillManifest, content: string) => Promise<string>;
  uninstallSkill: (id: string) => Promise<void>;
  updateSkill: (id: string, content: string, description?: string) => Promise<void>;
  listAll: () => InstalledSkill[];
}

let registry: SkillRegistry | null = null;
let loadPromise: Promise<void> | null = null;

function getRegistry(): SkillRegistry {
  if (!registry) {
    registry = createSkillRegistry();
  }
  return registry;
}

async function persistEnabledIds(enabledSkillIds: Set<string>): Promise<void> {
  await db.settings.put({
    name: SKILL_ENABLED_SETTING,
    value: [...enabledSkillIds],
  });
}

export const useSkillStore = create<SkillState>((set, get) => ({
  skills: [],
  enabledSkillIds: new Set<string>(),

  loadSkills: async () => {
    if (loadPromise) return loadPromise;
    loadPromise = (async () => {
      try {
        const reg = getRegistry();
        const skills = await reg.loadBuiltin();

        const record = await db.settings.get(SKILL_ENABLED_SETTING);
        const raw = record?.value;
        const enabledIds =
          Array.isArray(raw) && raw.every((v): v is string => typeof v === "string") ? raw : [];

        const enabledSet = new Set<string>();
        for (const skill of skills) {
          if (enabledIds.includes(skill.manifest.id)) {
            enabledSet.add(skill.manifest.id);
          }
        }

        set({ skills, enabledSkillIds: enabledSet });
      } finally {
        loadPromise = null;
      }
    })();
    return loadPromise;
  },

  toggleSkill: async (id: string) => {
    const { enabledSkillIds } = get();
    const newSet = new Set(enabledSkillIds);
    const currentlyEnabled = newSet.has(id);

    if (currentlyEnabled) {
      newSet.delete(id);
    } else {
      newSet.add(id);
    }

    await persistEnabledIds(newSet);
    set({ enabledSkillIds: newSet });
  },

  isEnabled: (id: string) => get().enabledSkillIds.has(id),

  importSkill: async (manifest, content) => {
    const id = `imported-${manifest.id}-${Date.now()}`;
    const setting = { name: `skill:${id}`, value: { manifest, content, imported: true } };
    await db.settings.put(setting);
    const skill: InstalledSkill = {
      manifest: { ...manifest, source: "imported" },
      rootPath: "",
      builtIn: false,
    };
    set((state) => ({ skills: [...state.skills, skill] }));
    return id;
  },

  createSkill: async (name, description, content) => {
    const id = `created-${name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .slice(0, 30)}-${Date.now()}`;
    const manifest: SkillManifest = {
      schemaVersion: 1,
      id,
      name,
      version: "0.1.0",
      description,
      entry: "SKILL.md",
      source: "created",
      capabilities: [],
      optionalCapabilities: [],
      optionalMcpServers: [],
      riskLevel: "low",
    };
    await db.settings.put({ name: `skill:${id}`, value: { manifest, content } });
    const skill: InstalledSkill = { manifest, rootPath: "", builtIn: false };
    set((state) => ({ skills: [...state.skills, skill] }));
    return id;
  },

  installSkill: async (manifest, content) => {
    const errors = validateManifest(manifest);
    if (errors.length > 0) {
      throw new Error(`Invalid skill manifest: ${errors.join(", ")}`);
    }
    const id = manifest.id;
    const alreadyInstalled =
      get().skills.some((s) => s.manifest.id === id) ||
      (await db.settings.get(`skill:${id}`)) !== undefined;
    if (alreadyInstalled) {
      throw new Error(`Skill "${id}" is already installed`);
    }
    await db.settings.put({ name: `skill:${id}`, value: { manifest, content } });
    const skill: InstalledSkill = { manifest, rootPath: "", builtIn: false };
    set((state) => ({ skills: [...state.skills, skill] }));
    return id;
  },

  uninstallSkill: async (id) => {
    await db.settings.delete(`skill:${id}`);
    set((state) => ({
      skills: state.skills.filter((s) => s.manifest.id !== id),
      enabledSkillIds: (() => {
        const next = new Set(state.enabledSkillIds);
        next.delete(id);
        return next;
      })(),
    }));
    const remaining = get().enabledSkillIds;
    if (remaining.size === 0) {
      await db.settings.delete(SKILL_ENABLED_SETTING);
    } else {
      await persistEnabledIds(remaining);
    }
  },

  updateSkill: async (id, content, description) => {
    const record = await db.settings.get(`skill:${id}`);
    const existingValue = record?.value as
      { manifest: SkillManifest; content: string; [key: string]: unknown } | undefined;
    const current = get().skills.find((s) => s.manifest.id === id);
    const baseManifest = existingValue?.manifest ?? current?.manifest;
    if (!baseManifest) {
      throw new Error(`Skill not found: ${id}`);
    }
    const manifest = description !== undefined ? { ...baseManifest, description } : baseManifest;

    await db.settings.put({
      name: `skill:${id}`,
      value: { ...existingValue, manifest, content },
    });
    set((state) => ({
      skills: state.skills.map((s) => (s.manifest.id === id ? { ...s, manifest } : s)),
    }));
  },

  listAll: () => get().skills,

  getEnabledContent: async () => {
    const { enabledSkillIds, skills } = get();
    const reg = getRegistry();
    const builtinIds = new Set(reg.list().map((s) => s.manifest.id));
    const builtinEnabledIds = new Set([...enabledSkillIds].filter((id) => builtinIds.has(id)));
    const builtinContent = await reg.getEnabledContent(builtinEnabledIds);

    const customSkills = skills.filter((s) => !s.builtIn && enabledSkillIds.has(s.manifest.id));
    const customContents = await Promise.all(
      customSkills.map(async (s) => {
        const record = await db.settings.get(`skill:${s.manifest.id}`);
        const value = record?.value as { content?: string } | undefined;
        return `## ${s.manifest.name}\n\n${value?.content ?? ""}`;
      }),
    );

    return [builtinContent, ...customContents].filter(Boolean).join("\n\n---\n\n");
  },
}));
