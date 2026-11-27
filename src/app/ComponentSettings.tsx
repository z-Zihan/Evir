import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Switch } from "../components/ui";
import { InlineError } from "../components/feedback";
import {
  SettingsGroup,
  SettingsPage,
  SettingsPageIntro,
  SettingsRow,
} from "../components/settings";
import type { ComponentConfigurationMap, ComponentInspection } from "../core/components/types";
import {
  loadComponentConfiguration,
  saveComponentConfiguration,
} from "../features/settings/component-configuration";
import { getRuntime } from "../runtime/use-runtime";

/**
 * Component switches. This is the surface that makes opt-in components
 * (computer use, background tasks) reachable at all: they ship disabled and
 * only a stored, user-facing switch can turn them on.
 *
 * Changes apply immediately through `reconcile`, so no restart is needed; the
 * stored map is the source of truth for the next launch.
 */
export function ComponentSettings() {
  const { t } = useTranslation();
  const [configuration, setConfiguration] = useState<ComponentConfigurationMap>({});
  const [components, setComponents] = useState<readonly ComponentInspection[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const stored = await loadComponentConfiguration();
        if (cancelled) return;
        setConfiguration(stored);
        setComponents(getRuntime().componentRuntime?.inspect(stored) ?? []);
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : String(loadError));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const toggle = async (id: string, enabled: boolean) => {
    setBusyId(id);
    setError("");
    try {
      const next = { ...configuration, [id]: { enabled } };
      await saveComponentConfiguration(next);
      const runtime = getRuntime();
      runtime.componentRuntime?.reconcile(next);
      setConfiguration(next);
      setComponents(runtime.componentRuntime?.inspect(next) ?? []);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <SettingsPage>
      <SettingsPageIntro
        title={t("settings.components")}
        description={t("settingsDescriptions.components")}
      />
      <SettingsGroup>
        {components.map((component) => {
          const stored = configuration[component.id]?.enabled;
          const checked = stored ?? component.state === "active";
          const unavailable = component.state === "incompatible";
          return (
            <SettingsRow
              key={component.id}
              label={<span className="font-mono text-[12px]">{component.id}</span>}
              description={t(`settings.componentState.${component.state}`)}
              control={
                <Switch
                  checked={checked}
                  disabled={unavailable || busyId === component.id}
                  onCheckedChange={(next) => void toggle(component.id, Boolean(next))}
                  aria-label={component.id}
                />
              }
            />
          );
        })}
      </SettingsGroup>
      {error && <InlineError message={t("settings.componentSaveFailed", { message: error })} />}
    </SettingsPage>
  );
}
