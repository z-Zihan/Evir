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
    const reg = getRegistry();
    const skills = await reg.loadBuiltin();

    const record = await db.settings.get(SKILL_ENABLED_SETTING);
    const enabledIds = Array.isArray(record?.value) ? (record.value as string[]) : [];

    const enabledSet = new Set<string>();
    for (const skill of skills) {
      if (enabledIds.includes(skill.manifest.id)) {
        reg.setEnabled(skill.manifest.id, true);
        enabledSet.add(skill.manifest.id);
      }
    }

    set({ skills, enabledSkillIds: enabledSet });
  },

  toggleSkill: async (id: string) => {
    const reg = getRegistry();
    const { enabledSkillIds } = get();
    const newSet = new Set(enabledSkillIds);
    const currentlyEnabled = newSet.has(id);

    if (currentlyEnabled) {
      newSet.delete(id);
      reg.setEnabled(id, false);
    } else {
      newSet.add(id);
      reg.setEnabled(id, true);
    }

    await persistEnabledIds(newSet);
    set({ enabledSkillIds: newSet });
  },

  isEnabled: (id: string) => get().enabledSkillIds.has(id),

  getEnabledContent: async () => getRegistry().getEnabledContent(),
}));
