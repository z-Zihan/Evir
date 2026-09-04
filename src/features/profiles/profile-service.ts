import { create } from "zustand";
import { tauriInvoke } from "../../runtime/tauri-ipc";
import { setActiveProfileIdSync, DEFAULT_PROFILE_ID } from "../../core/profile/profile-scope";
import {
  isValidProfileName,
  profilesSnapshotSchema,
  type ProfilesSnapshot,
  type UserProfile,
} from "./profile-types";

/**
 * User profile service (§49-61). Desktop: the Rust registry at
 * `<app-data>/profiles.json` is authoritative (per-profile DB/vault/logs are
 * resolved host-side). Web: an equivalent registry in localStorage with
 * per-profile Dexie databases (`evir:<id>`). The service runs before the app
 * stores hydrate (see main.tsx bootstrap) and keeps the synchronous mirror in
 * `core/profile/profile-scope` warm for module-init-time consumers.
 */

const WEB_REGISTRY_KEY = "evir:profile-registry";

function isDesktop(): boolean {
  return "__TAURI_INTERNALS__" in globalThis;
}

// ---------------------------------------------------------------- web adapter

function readWebRegistry(): ProfilesSnapshot {
  const now = Date.now();
  const fallback: ProfilesSnapshot = {
    profiles: [
      {
        id: DEFAULT_PROFILE_ID,
        displayName: "User",
        createdAt: now,
        lastActiveAt: now,
      },
    ],
    activeProfileId: DEFAULT_PROFILE_ID,
  };
  try {
    const raw = window.localStorage.getItem(WEB_REGISTRY_KEY);
    if (!raw) return fallback;
    const parsed = profilesSnapshotSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : fallback;
  } catch {
    return fallback;
  }
}

function writeWebRegistry(snapshot: ProfilesSnapshot): void {
  window.localStorage.setItem(WEB_REGISTRY_KEY, JSON.stringify(snapshot));
}

// -------------------------------------------------------------- unified API

interface ProfileStore {
  snapshot: ProfilesSnapshot | null;
  loaded: boolean;
  /** Resolve + mirror the active profile. Idempotent, must run before stores. */
  init: () => Promise<ProfilesSnapshot>;
  list: () => Promise<ProfilesSnapshot>;
  create: (displayName: string, avatar?: string) => Promise<UserProfile>;
  update: (
    profileId: string,
    changes: { displayName?: string; avatar?: string | null },
  ) => Promise<UserProfile>;
  /** Delete a non-active profile (switch away first). */
  remove: (profileId: string) => Promise<void>;
  /**
   * Activate a profile. v1 semantics (§58-59): the caller stops the current
   * profile's active work first; activation swaps the host DB connection and
   * the mirror, then the caller reloads the app so no half-switched state
   * survives.
   */
  activate: (profileId: string) => Promise<void>;
}

export const useProfileStore = create<ProfileStore>((set, get) => ({
  snapshot: null,
  loaded: false,
  init: async () => {
    const snapshot = await get().list();
    setActiveProfileIdSync(snapshot.activeProfileId);
    set({ snapshot, loaded: true });
    return snapshot;
  },
  list: async () => {
    if (isDesktop()) {
      const snapshot = profilesSnapshotSchema.parse(await tauriInvoke("profiles_list"));
      set({ snapshot });
      return snapshot;
    }
    const snapshot = readWebRegistry();
    set({ snapshot });
    return snapshot;
  },
  create: async (displayName, avatar) => {
    if (!isValidProfileName(displayName)) throw new Error("profile: invalid name");
    if (isDesktop()) {
      const profile = await tauriInvoke<UserProfile>("profiles_create", {
        displayName,
        ...(avatar !== undefined ? { avatar } : {}),
      });
      await get().list();
      return profile;
    }
    const registry = readWebRegistry();
    const now = Date.now();
    const id = `u${Math.random().toString(36).slice(2, 10)}`;
    const profile: UserProfile = {
      id,
      displayName: displayName.trim(),
      ...(avatar !== undefined && avatar !== "" ? { avatar } : {}),
      createdAt: now,
      lastActiveAt: now,
    };
    const next = {
      profiles: [...registry.profiles, profile],
      activeProfileId: registry.activeProfileId,
    };
    writeWebRegistry(next);
    set({ snapshot: next });
    return profile;
  },
  update: async (profileId, changes) => {
    if (changes.displayName !== undefined && !isValidProfileName(changes.displayName)) {
      throw new Error("profile: invalid name");
    }
    if (isDesktop()) {
      const updated = await tauriInvoke<UserProfile>("profiles_update", {
        profileId,
        ...(changes.displayName !== undefined ? { displayName: changes.displayName } : {}),
        ...(changes.avatar !== undefined ? { avatar: changes.avatar } : {}),
      });
      await get().list();
      return updated;
    }
    const registry = readWebRegistry();
    const profiles = registry.profiles.map((profile) =>
      profile.id === profileId
        ? {
            ...profile,
            ...(changes.displayName !== undefined
              ? { displayName: changes.displayName.trim() }
              : {}),
            ...(changes.avatar !== undefined ? { avatar: changes.avatar ?? undefined } : {}),
          }
        : profile,
    );
    const next = { ...registry, profiles };
    writeWebRegistry(next);
    set({ snapshot: next });
    const updated = profiles.find((profile) => profile.id === profileId);
    if (!updated) throw new Error(`profile not found: ${profileId}`);
    return updated;
  },
  remove: async (profileId) => {
    if (isDesktop()) {
      await tauriInvoke("profiles_delete", { profileId });
      await get().list();
      return;
    }
    const registry = readWebRegistry();
    if (registry.activeProfileId === profileId) {
      throw new Error("profile: switch away before deleting");
    }
    if (registry.profiles.length <= 1) throw new Error("profile: cannot delete the last profile");
    const next = {
      profiles: registry.profiles.filter((profile) => profile.id !== profileId),
      activeProfileId: registry.activeProfileId,
    };
    writeWebRegistry(next);
    set({ snapshot: next });
  },
  activate: async (profileId) => {
    if (isDesktop()) {
      // Host swaps the managed SQLite connection; the webview then reloads.
      await tauriInvoke("profiles_set_active", { profileId });
    } else {
      const registry = readWebRegistry();
      if (!registry.profiles.some((profile) => profile.id === profileId)) {
        throw new Error(`profile not found: ${profileId}`);
      }
      writeWebRegistry({
        ...registry,
        activeProfileId: profileId,
        profiles: registry.profiles.map((profile) =>
          profile.id === profileId ? { ...profile, lastActiveAt: Date.now() } : profile,
        ),
      });
    }
    setActiveProfileIdSync(profileId);
    await get().list();
  },
}));

/** The active profile, or a minimal default before init resolves. */
export function activeProfileOrDefault(): UserProfile {
  const snapshot = useProfileStore.getState().snapshot;
  const fallback: UserProfile = {
    id: DEFAULT_PROFILE_ID,
    displayName: "User",
    createdAt: 0,
    lastActiveAt: 0,
  };
  if (!snapshot) return fallback;
  return snapshot.profiles.find((profile) => profile.id === snapshot.activeProfileId) ?? fallback;
}
