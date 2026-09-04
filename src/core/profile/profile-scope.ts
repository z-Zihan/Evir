/**
 * Synchronous active-profile mirror (§52). The authoritative registry lives
 * with the host (Rust `profiles.json` on desktop, localStorage on web) and is
 * async to read — but Dexie's per-profile database name and profile-scoped
 * localStorage keys are needed at module-init time. `main.tsx` therefore
 * bootstraps the profile service BEFORE the app bundle's stores load and the
 * mirror is written here; every later launch reads a warm mirror.
 */

const MIRROR_KEY = "evir:active-profile";
export const DEFAULT_PROFILE_ID = "default";

export function getActiveProfileIdSync(): string {
  try {
    const value = window.localStorage?.getItem(MIRROR_KEY);
    return value && value.length > 0 ? value : DEFAULT_PROFILE_ID;
  } catch {
    return DEFAULT_PROFILE_ID;
  }
}

export function setActiveProfileIdSync(profileId: string): void {
  try {
    window.localStorage?.setItem(MIRROR_KEY, profileId);
  } catch {
    // Storage may be unavailable (SSR/tests): profile resolution still works
    // through the async registry; scoping silently falls back to default.
  }
}

/** Dexie database namespace per profile (§52): never share one "evir" DB. */
export function dexieDatabaseName(): string {
  return `evir:${getActiveProfileIdSync()}`;
}

/**
 * Profile-scoped localStorage key with legacy adoption: the default profile
 * inherits the unscoped value an existing install already has; other profiles
 * start clean.
 */
export function readProfileScoped(key: string): string | null {
  const scope = getActiveProfileIdSync();
  const storage = typeof window === "undefined" ? undefined : window.localStorage;
  if (!storage) return null;
  const scoped = storage.getItem(`${key}::${scope}`);
  if (scoped !== null) return scoped;
  if (scope === DEFAULT_PROFILE_ID) return storage.getItem(key);
  return null;
}

export function writeProfileScoped(key: string, value: string): void {
  const scope = getActiveProfileIdSync();
  const storage = typeof window === "undefined" ? undefined : window.localStorage;
  if (!storage) return;
  storage.setItem(`${key}::${scope}`, value);
}
