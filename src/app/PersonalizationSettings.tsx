import { useEffect, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Button, Switch, Textarea } from "../components/ui";
import { FieldBlock, FormControl, FormLabel, InlineError } from "../components/feedback";
import {
  SettingsDescription,
  SettingsGroup,
  SettingsOptionCard,
  SettingsOptionCardGrid,
  SettingsPage,
  SettingsPageIntro,
  SettingsRow,
  SettingsSection,
} from "../components/settings";
import {
  DEFAULT_PERSONALIZATION_PREFERENCES,
  type PersonalizationPreferences,
} from "../core/personalization/types";
import {
  loadPersonalizationPreferences,
  savePersonalizationPreferences,
} from "../features/settings/personalization-settings";
import { useConfirmationDialog } from "./useConfirmationDialog";

type FormStatus = "idle" | "loading" | "saving";
type FormError = "load" | "save" | null;
type ResponsePreferences = Pick<
  PersonalizationPreferences,
  "enabled" | "responseLanguage" | "detailLevel" | "style" | "customInstructions"
>;

const responsePreferencesFrom = ({
  enabled,
  responseLanguage,
  detailLevel,
  style,
  customInstructions,
}: PersonalizationPreferences): ResponsePreferences => ({
  enabled,
  responseLanguage,
  detailLevel,
  style,
  customInstructions,
});

export function PersonalizationPanel() {
  const { t } = useTranslation();
  const [form, setForm] = useState<PersonalizationPreferences>({
    ...DEFAULT_PERSONALIZATION_PREFERENCES,
  });
  const [status, setStatus] = useState<FormStatus>("loading");
  const [error, setError] = useState<FormError>(null);
  const { requestConfirmation, confirmationDialog } = useConfirmationDialog();

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

  const persist = async (preferences: ResponsePreferences) => {
    setStatus("saving");
    setError(null);
    try {
      const current = await loadPersonalizationPreferences();
      const next = { ...current, ...preferences };
      await savePersonalizationPreferences(next);
      setForm(next);
      window.dispatchEvent(new Event("evir:personalization-updated"));
    } catch {
      setError("save");
    } finally {
      setStatus("idle");
    }
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void persist(responsePreferencesFrom(form));
  };

  const handleReset = () =>
    requestConfirmation(
      {
        title: t("confirmation.resetTitle"),
        description: t("confirmation.resetDescription", {
          item: t("settings.personalization"),
        }),
        confirmLabel: t("personalization.reset"),
        tone: "warning",
      },
      () => persist(responsePreferencesFrom(DEFAULT_PERSONALIZATION_PREFERENCES)),
    );

  return (
    <SettingsPage>
      <SettingsPageIntro
        eyebrow={t("settingsDescriptions.responsePreferences")}
        description={t("settingsDescriptions.personalization")}
      />
      <form onSubmit={handleSubmit} className="flex min-w-0 flex-col gap-6">
        <SettingsGroup>
          <SettingsRow
            label={t("personalization.enable")}
            control={
              <>
                <span className="text-[11px] text-muted">
                  {form.enabled ? t("personalization.on") : t("personalization.off")}
                </span>
                <Switch
                  checked={form.enabled}
                  disabled={status !== "idle"}
                  onCheckedChange={(checked) => update("enabled", checked)}
                  aria-label={t("personalization.enable")}
                />
              </>
            }
          />
        </SettingsGroup>

        <fieldset disabled={status !== "idle"} className="flex min-w-0 flex-col gap-6">
          <SettingsSection
            title={t("personalization.responseLanguage")}
            description={t("personalization.languageDescription")}
          >
            <SettingsOptionCardGrid>
              {(["follow-app", "zh-CN", "en"] as const).map((value) => (
                <SettingsOptionCard
                  key={value}
                  title={t(`personalization.languageOptions.${value}.label`)}
                  description={t(`personalization.languageOptions.${value}.description`)}
                  selected={form.responseLanguage === value}
                  onClick={() => update("responseLanguage", value)}
                />
              ))}
            </SettingsOptionCardGrid>
          </SettingsSection>

          <div className="grid gap-6 lg:grid-cols-2">
            <SettingsSection
              title={t("personalization.detailLevel")}
              description={t("personalization.detailDescription")}
            >
              <div className="flex flex-col gap-2">
                {(["concise", "balanced", "detailed"] as const).map((value) => (
                  <SettingsOptionCard
                    key={value}
                    title={t(`personalization.${value}`)}
                    description={t(`personalization.detailOptions.${value}`)}
                    selected={form.detailLevel === value}
                    onClick={() => update("detailLevel", value)}
                    meta={
                      <span aria-hidden="true" className={`detail-lines ${value}`}>
                        <i />
                        <i />
                        <i />
                      </span>
                    }
                  />
                ))}
              </div>
            </SettingsSection>

            <SettingsSection
              title={t("personalization.style")}
              description={t("personalization.styleDescription")}
            >
              <div className="flex flex-col gap-2">
                {(["professional", "casual", "academic"] as const).map((value) => (
                  <SettingsOptionCard
                    key={value}
                    title={t(`personalization.${value}`)}
                    description={t(`personalization.styleOptions.${value}`)}
                    selected={form.style === value}
                    onClick={() => update("style", value)}
                  />
                ))}
              </div>
            </SettingsSection>
          </div>

          <SettingsSection
            title={t("personalization.customInstructions")}
            description={t("personalization.instructionsDescription")}
          >
            <FieldBlock name="customInstructions">
              <FormLabel className="sr-only">{t("personalization.customInstructions")}</FormLabel>
              <FormControl
                render={
                  <Textarea
                    value={form.customInstructions}
                    maxLength={2000}
                    rows={7}
                    placeholder={t("personalization.instructionsPlaceholder")}
                    onChange={(event) => update("customInstructions", event.target.value)}
                  />
                }
              />
              <span className="self-end text-[10px] tabular-nums text-muted">
                {form.customInstructions.length} / 2000
              </span>
            </FieldBlock>
          </SettingsSection>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <SettingsDescription>{t("personalization.localNote")}</SettingsDescription>
            <div className="flex items-center justify-end gap-2">
              <Button variant="secondary" onClick={handleReset}>
                {t("personalization.reset")}
              </Button>
              <Button variant="primary" type="submit">
                {status === "saving" ? t("personalization.saving") : t("personalization.save")}
              </Button>
            </div>
          </div>
        </fieldset>

        {error && <InlineError message={t(`personalization.${error}Error`)} />}
      </form>
      {confirmationDialog}
    </SettingsPage>
  );
}
