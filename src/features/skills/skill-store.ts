import { create } from "zustand";
// NOTE: Uses Dexie directly for settings; StoragePort covers basic CRUD
import type { SettingRecord } from "../../core/storage/db";
import type { SkillManifest } from "../../core/skills/types";
import { validateManifest } from "../../core/skills/types";
import { createSkillRegistry, type SkillRegistry } from "../../core/skills/skill-registry";
import type { InstalledSkill } from "../../core/skills/types";
import { getStructuredStorage } from "../../runtime/structured-storage";
import {
  customCategoryLocalizations,
  normalizeCustomCategory,
} from "../../core/skills/skill-categories";

const SKILL_ENABLED_SETTING = "skillEnabledIds";

interface SkillState {
  skills: InstalledSkill[];
  enabledSkillIds: Set<string>;
  loadSkills: () => Promise<void>;
  toggleSkill: (id: string) => Promise<void>;
  isEnabled: (id: string) => boolean;
  getEnabledContent: (selectedIds?: ReadonlySet<string>) => Promise<string>;
  getSkillContent: (selectedIds: ReadonlySet<string>) => Promise<string>;
  importSkill: (manifest: SkillManifest, content: string) => Promise<string>;
  createSkill: (
    name: string,
    description: string,
    content: string,
    category?: string,
  ) => Promise<string>;
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
  await getStructuredStorage().write("settings", SKILL_ENABLED_SETTING, {
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
        const builtins = await reg.loadBuiltin();
        const settings = await getStructuredStorage().readAll<SettingRecord>("settings");
        const customSkills = settings
          .filter(({ name }) => name.startsWith("skill:"))
          .flatMap(({ value }) => {
            const stored = value as { manifest?: SkillManifest; content?: string } | undefined;
            if (!stored?.manifest || typeof stored.content !== "string") return [];
            if (validateManifest(stored.manifest).length > 0) return [];
            return [
              {
                manifest: stored.manifest,
                rootPath: "",
                builtIn: false,
              } satisfies InstalledSkill,
            ];
          });
        const skills = [
          ...builtins,
          ...customSkills.filter(
            (custom) => !builtins.some((item) => item.manifest.id === custom.manifest.id),
          ),
        ];

        const record = settings.find(({ name }) => name === SKILL_ENABLED_SETTING);
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
    return get().installSkill({ ...manifest, source: "imported" }, content);
  },

  createSkill: async (name, description, content, category = "other") => {
    const id = `created-${name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .slice(0, 30)}-${Date.now()}`;
    const categoryLocalizations = customCategoryLocalizations(category);
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
      platforms: ["web", "desktop"],
      category: normalizeCustomCategory(category),
      ...(categoryLocalizations ? { categoryLocalizations } : {}),
    };
    await getStructuredStorage().write("settings", `skill:${id}`, {
      name: `skill:${id}`,
      value: { manifest, content },
    });
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
      (await getStructuredStorage().read("settings", `skill:${id}`)) !== undefined;
    if (alreadyInstalled) {
      throw new Error(`Skill "${id}" is already installed`);
    }
    await getStructuredStorage().write("settings", `skill:${id}`, {
      name: `skill:${id}`,
      value: { manifest, content },
    });
    const skill: InstalledSkill = { manifest, rootPath: "", builtIn: false };
    set((state) => ({ skills: [...state.skills, skill] }));
    return id;
  },

  uninstallSkill: async (id) => {
    await getStructuredStorage().delete("settings", `skill:${id}`);
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
      await getStructuredStorage().delete("settings", SKILL_ENABLED_SETTING);
    } else {
      await persistEnabledIds(remaining);
    }
  },

  updateSkill: async (id, content, description) => {
    const record = await getStructuredStorage().read<SettingRecord>("settings", `skill:${id}`);
    const existingValue = record?.value as
      { manifest: SkillManifest; content: string; [key: string]: unknown } | undefined;
    const current = get().skills.find((s) => s.manifest.id === id);
    const baseManifest = existingValue?.manifest ?? current?.manifest;
    if (!baseManifest) {
      throw new Error(`Skill not found: ${id}`);
    }
    const manifest = description !== undefined ? { ...baseManifest, description } : baseManifest;

    await getStructuredStorage().write("settings", `skill:${id}`, {
      name: `skill:${id}`,
      value: { ...existingValue, manifest, content },
    });
    set((state) => ({
      skills: state.skills.map((s) => (s.manifest.id === id ? { ...s, manifest } : s)),
    }));
  },

  listAll: () => get().skills,

  getEnabledContent: async (selectedIds) => {
    const { enabledSkillIds } = get();
    const activeIds = new Set(
      [...enabledSkillIds].filter((id) => selectedIds === undefined || selectedIds.has(id)),
    );
    return get().getSkillContent(activeIds);
  },

  getSkillContent: async (selectedIds) => {
    const { skills } = get();
    const reg = getRegistry();
    const builtinIds = new Set(reg.list().map((s) => s.manifest.id));
    const selectedBuiltinIds = new Set([...selectedIds].filter((id) => builtinIds.has(id)));
    const builtinContent = await reg.getEnabledContent(selectedBuiltinIds);

    const customSkills = skills.filter((s) => !s.builtIn && selectedIds.has(s.manifest.id));
    const customContents = await Promise.all(
      customSkills.map(async (s) => {
        const record = await getStructuredStorage().read<SettingRecord>(
          "settings",
          `skill:${s.manifest.id}`,
        );
        const value = record?.value as { content?: string } | undefined;
        return `## ${s.manifest.name}\n\n${value?.content ?? ""}`;
      }),
    );

    return [builtinContent, ...customContents].filter(Boolean).join("\n\n---\n\n");
  },
}));
