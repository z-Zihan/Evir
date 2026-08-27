import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { logger } from "../../../core/logging/logger";
import { DEFAULT_PERSONALIZATION_PREFERENCES } from "../../../core/personalization/types";
import { db } from "../../../core/storage/db";
import {
  loadPersonalizationPreferences,
  savePersonalizationPreferences,
} from "../personalization-settings";

beforeEach(async () => {
  await db.settings.clear();
  logger.clear();
});

describe("personalization diagnostics", () => {
  it("records save and load metadata without custom instruction text", async () => {
    const customInstructions = "PRIVATE_PERSONALIZATION_MARKER";
    await savePersonalizationPreferences(
      { ...DEFAULT_PERSONALIZATION_PREFERENCES, enabled: true, customInstructions },
      db,
    );
    await loadPersonalizationPreferences(db);

    expect(logger.getEntries().map(({ event }) => event)).toEqual(
      expect.arrayContaining(["personalization.saved", "personalization.loaded"]),
    );
    expect(logger.exportLogs()).not.toContain(customInstructions);
  });
});
