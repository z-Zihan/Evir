import { z } from "zod";
import {
  DEFAULT_PERSONALIZATION_PREFERENCES,
  AVATAR_COLORS,
  RESPONSE_DETAIL_LEVELS,
  RESPONSE_LANGUAGES,
  RESPONSE_STYLES,
  type PersonalizationPreferences,
} from "../../core/personalization/types";
import { db, type EvirDB } from "../../core/storage/db";

const PERSONALIZATION_SETTING_NAME = "personalization";
type SettingsDatabase = Pick<EvirDB, "settings">;

const personalizationSchema = z.object({
  enabled: z.boolean(),
  displayName: z.string(),
  avatarColor: z.enum(AVATAR_COLORS).default("sage"),
  avatarImage: z
    .string()
    .max(500_000)
    .refine((value) => !value || /^data:image\/(?:jpeg|png|webp);base64,/.test(value))
    .default(""),
  responseLanguage: z.enum(RESPONSE_LANGUAGES),
  detailLevel: z.enum(RESPONSE_DETAIL_LEVELS),
  style: z.enum(RESPONSE_STYLES),
  customInstructions: z.string().max(2000),
});

function defaults(): PersonalizationPreferences {
  return { ...DEFAULT_PERSONALIZATION_PREFERENCES };
}

export async function loadPersonalizationPreferences(
  database: SettingsDatabase = db,
): Promise<PersonalizationPreferences> {
  const record = await database.settings.get(PERSONALIZATION_SETTING_NAME);
  const result = personalizationSchema.safeParse(record?.value);
  if (!result.success) return defaults();
  // “子涵” was used by an early UI prototype as demo content, not as a user default.
  return result.data.displayName.trim() === "子涵"
    ? { ...result.data, displayName: "" }
    : result.data;
}

export async function savePersonalizationPreferences(
  preferences: PersonalizationPreferences,
  database: SettingsDatabase = db,
): Promise<void> {
  const value = personalizationSchema.parse(preferences);
  await database.settings.put({ name: PERSONALIZATION_SETTING_NAME, value });
}
