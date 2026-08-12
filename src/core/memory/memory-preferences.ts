import { z } from "zod";
import type { SettingRecord } from "../storage/db";
import type { StoragePort } from "../storage/storage-port";

export const MEMORY_ENABLED_SETTING = "memory.enabled";

const memoryEnabledSchema = z.boolean();

export async function isMemoryEnabled(storage: StoragePort): Promise<boolean> {
  const setting = await storage.read<SettingRecord>("settings", MEMORY_ENABLED_SETTING);
  const parsed = memoryEnabledSchema.safeParse(setting?.value);
  return parsed.success ? parsed.data : true;
}

export async function setMemoryEnabled(storage: StoragePort, enabled: boolean): Promise<void> {
  await storage.write("settings", MEMORY_ENABLED_SETTING, {
    name: MEMORY_ENABLED_SETTING,
    value: enabled,
  });
}
