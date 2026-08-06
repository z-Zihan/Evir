import { useEffect, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import {
  DEFAULT_PERSONALIZATION_PREFERENCES,
  type PersonalizationPreferences,
} from "../core/personalization/types";
import {
  loadPersonalizationPreferences,
  savePersonalizationPreferences,
} from "../features/settings/personalization-settings";

type FormStatus = "idle" | "loading" | "saving";
type FormError = "load" | "save" | null;

export function PersonalizationPanel() {
  const { t } = useTranslation();
  const [form, setForm] = useState<PersonalizationPreferences>({
    ...DEFAULT_PERSONALIZATION_PREFERENCES,
  });
  const [status, setStatus] = useState<FormStatus>("loading");
  const [error, setError] = useState<FormError>(null);

  useEffect(() => {
    let mounted = true;
    void loadPersonalizationPreferences()
      .then((preferences) => {
        if (mounted) setForm(preferences);
      })
      .catch(() => {
        if (mounted) setError("load");
      })
      .finally(() => {
        if (mounted) setStatus("idle");
      });
    return () => {
      mounted = false;
    };
  }, []);

  const update = <Key extends keyof PersonalizationPreferences>(
    key: Key,
    value: PersonalizationPreferences[Key],
  ) => setForm((current) => ({ ...current, [key]: value }));

  const persist = async (preferences: PersonalizationPreferences) => {
    setStatus("saving");
    setError(null);
    try {
      await savePersonalizationPreferences(preferences);
      setForm(preferences);
    } catch {
      setError("save");
    } finally {
      setStatus("idle");
    }
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void persist(form);
  };

  const handleReset = () => void persist({ ...DEFAULT_PERSONALIZATION_PREFERENCES });

  return (
    <section className="personalization-settings">
      <div className="settings-page-intro compact">
        <div>
          <span className="settings-page-eyebrow">
            {t("settingsDescriptions.responsePreferences")}
          </span>
          <p>{t("settingsDescriptions.personalization")}</p>
        </div>
      </div>
      <form onSubmit={handleSubmit}>
        <fieldset disabled={status !== "idle"}>
          <label className="personalization-toggle">
            <input
              type="checkbox"
              checked={form.enabled}
              onChange={(event) => update("enabled", event.target.checked)}
            />
            <span>{t("personalization.enable")}</span>
          </label>
          <label>
            {t("personalization.displayName")}
            <input
              type="text"
              value={form.displayName}
              onChange={(event) => update("displayName", event.target.value)}
            />
          </label>
          <label>
            {t("personalization.responseLanguage")}
            <select
              value={form.responseLanguage}
              onChange={(event) => {
                // Safe: select options are type-constrained
                update(
                  "responseLanguage",
                  event.target.value as PersonalizationPreferences["responseLanguage"],
                );
              }}
            >
              <option value="follow-app">{t("personalization.followApp")}</option>
              <option value="en">{t("personalization.english")}</option>
              <option value="zh-CN">{t("personalization.chinese")}</option>
            </select>
          </label>
          <label>
            {t("personalization.detailLevel")}
            <select
              value={form.detailLevel}
              onChange={(event) => {
                // Safe: select options are type-constrained
                update(
                  "detailLevel",
                  event.target.value as PersonalizationPreferences["detailLevel"],
                );
              }}
            >
              <option value="concise">{t("personalization.concise")}</option>
              <option value="balanced">{t("personalization.balanced")}</option>
              <option value="detailed">{t("personalization.detailed")}</option>
            </select>
          </label>
          <label>
            {t("personalization.style")}
            <select
              value={form.style}
              onChange={(event) => {
                // Safe: select options are type-constrained
                update("style", event.target.value as PersonalizationPreferences["style"]);
              }}
            >
              <option value="professional">{t("personalization.professional")}</option>
              <option value="casual">{t("personalization.casual")}</option>
              <option value="academic">{t("personalization.academic")}</option>
            </select>
          </label>
          <label>
            {t("personalization.customInstructions")}
            <textarea
              value={form.customInstructions}
              maxLength={2000}
              rows={6}
              onChange={(event) => update("customInstructions", event.target.value)}
            />
          </label>
          <div className="personalization-actions">
            <button type="button" onClick={handleReset}>
              {t("personalization.reset")}
            </button>
            <button type="submit">{t("personalization.save")}</button>
          </div>
        </fieldset>
        {error && (
          <p className="personalization-error" role="alert">
            {t(`personalization.${error}Error`)}
          </p>
        )}
      </form>
    </section>
  );
}
