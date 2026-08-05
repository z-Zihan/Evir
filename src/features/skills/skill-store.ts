import { create } from "zustand";
// NOTE: Uses Dexie directly for settings; StoragePort covers basic CRUD
import { db } from "../../core/storage/db";
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

  getEnabledContent: async () => {
    const { enabledSkillIds } = get();
    return getRegistry().getEnabledContent(enabledSkillIds);
  },
}));
