import { useEffect, useState } from "react";
import { loadPersonalizationPreferences } from "../../features/settings/personalization-settings";

/**
 * Local display name + avatar for chat authoring, kept in sync with the
 * personalization settings via the app-wide update event.
 */
export function useLocalIdentity(): { displayName: string; avatar: string } {
  const [displayName, setDisplayName] = useState("");
  const [avatar, setAvatar] = useState("");

  useEffect(() => {
    let mounted = true;
    const load = () => {
      void loadPersonalizationPreferences()
        .then((preferences) => {
          if (mounted) setDisplayName(preferences.displayName.trim());
          if (mounted) setAvatar(preferences.avatarImage);
        })
        .catch(() => {
          if (mounted) setDisplayName("");
          if (mounted) setAvatar("");
        });
    };
    load();
    window.addEventListener("evir:personalization-updated", load);
    return () => {
      mounted = false;
      window.removeEventListener("evir:personalization-updated", load);
    };
  }, []);

  return { displayName, avatar };
}
