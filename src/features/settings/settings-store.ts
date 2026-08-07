import { create } from "zustand";
// NOTE: Uses Dexie directly for indexed queries; StoragePort covers basic CRUD
import type { SettingRecord } from "../../core/storage/db";
import { getStructuredStorage } from "../../runtime/structured-storage";

const PERSIST_API_KEYS = "persistApiKeys";

interface SettingsState {
  persistApiKeys: boolean;
  loadSettings: () => Promise<void>;
  setPersistApiKeys: (value: boolean) => Promise<void>;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  persistApiKeys: false,
  loadSettings: async () => {
    const setting = await getStructuredStorage().read<SettingRecord>("settings", PERSIST_API_KEYS);
    set({ persistApiKeys: setting?.value === true });
  },
  setPersistApiKeys: async (value) => {
    await getStructuredStorage().write("settings", PERSIST_API_KEYS, {
      name: PERSIST_API_KEYS,
      value,
    });
    set({ persistApiKeys: value });
  },
}));
