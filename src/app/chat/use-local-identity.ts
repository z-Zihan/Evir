import { useEffect, useState } from "react";
import { loadPersonalizationPreferences } from "../../features/settings/personalization-settings";
import { activeProfileOrDefault, useProfileStore } from "../../features/profiles/profile-service";

/**
 * Display name + avatar for chat authoring. The user profile (registry) is
 * authoritative; per-profile personalization identity fields act as a
 * fallback so nothing changes for data created before profiles existed.
 */
export function useLocalIdentity(): { displayName: string; avatar: string } {
  const [personalizedName, setPersonalizedName] = useState("");
  const [personalizedAvatar, setPersonalizedAvatar] = useState("");
  const profile = useProfileStore((state) => {
    if (!state.snapshot) return null;
    return (
      state.snapshot?.profiles.find((item) => item.id === state.snapshot?.activeProfileId) ?? null
    );
  });
  // Subscribe to list refreshes so rename/avatar edits propagate immediately.
  const listProfiles = useProfileStore((state) => state.list);
  useEffect(() => {
    void listProfiles().catch(() => undefined);
  }, [listProfiles]);

  useEffect(() => {
    let mounted = true;
    const load = () => {
      void loadPersonalizationPreferences()
        .then((preferences) => {
          if (mounted) setPersonalizedName(preferences.displayName.trim());
          if (mounted) setPersonalizedAvatar(preferences.avatarImage);
        })
        .catch(() => {
          if (mounted) setPersonalizedName("");
          if (mounted) setPersonalizedAvatar("");
        });
    };
    load();
    window.addEventListener("evir:personalization-updated", load);
    return () => {
      mounted = false;
      window.removeEventListener("evir:personalization-updated", load);
    };
  }, []);

  const active = profile ?? activeProfileOrDefault();
  const registryName = active.displayName.trim();
  return {
    displayName: registryName || personalizedName,
    avatar: active.avatar || personalizedAvatar,
  };
}
