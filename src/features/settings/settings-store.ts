import { create } from "zustand";
import { db } from "../../core/storage/db";

const PERSIST_API_KEYS = "persistApiKeys";

interface SettingsState {
  persistApiKeys: boolean;
  loadSettings: () => Promise<void>;
  setPersistApiKeys: (value: boolean) => Promise<void>;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  persistApiKeys: false,
  loadSettings: async () => {
    const setting = await db.settings.get(PERSIST_API_KEYS);
    set({ persistApiKeys: setting?.value === true });
  },
  setPersistApiKeys: async (value) => {
    await db.settings.put({ name: PERSIST_API_KEYS, value });
    set({ persistApiKeys: value });
  },
}));
