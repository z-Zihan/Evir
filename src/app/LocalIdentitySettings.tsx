import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Camera, ImagePlus, ShieldCheck, Trash2 } from "lucide-react";
import { Button, Input, Tip } from "../components/ui";
import {
  FieldBlock,
  FormControl,
  FormDescription,
  FormLabel,
  InlineError,
} from "../components/feedback";
import {
  SettingsControl,
  SettingsDescription,
  SettingsGroup,
  SettingsPage,
  SettingsPageIntro,
} from "../components/settings";
import {
  AVATAR_COLORS,
  DEFAULT_PERSONALIZATION_PREFERENCES,
  type PersonalizationPreferences,
} from "../core/personalization/types";
import {
  loadPersonalizationPreferences,
  savePersonalizationPreferences,
} from "../features/settings/personalization-settings";
import { AvatarCropDialog } from "./AvatarCropDialog";
import { validateAvatarFile } from "./avatar-image";
import { useConfirmationDialog } from "./useConfirmationDialog";

type IdentityForm = Pick<PersonalizationPreferences, "displayName" | "avatarColor" | "avatarImage">;
type FormStatus = "loading" | "idle" | "saving";

const DEFAULT_IDENTITY: IdentityForm = {
  displayName: DEFAULT_PERSONALIZATION_PREFERENCES.displayName,
  avatarColor: DEFAULT_PERSONALIZATION_PREFERENCES.avatarColor,
  avatarImage: DEFAULT_PERSONALIZATION_PREFERENCES.avatarImage,
};

export function LocalIdentityPanel() {
  const { t } = useTranslation();
  const [form, setForm] = useState<IdentityForm>({ ...DEFAULT_IDENTITY });
  const [status, setStatus] = useState<FormStatus>("loading");
  const [error, setError] = useState<string | null>(null);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const [cropSource, setCropSource] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { requestConfirmation, confirmationDialog } = useConfirmationDialog();

  useEffect(() => {
    let mounted = true;
    void loadPersonalizationPreferences()
      .then(({ displayName, avatarColor, avatarImage }) => {
        if (mounted) setForm({ displayName, avatarColor, avatarImage });
      })
      .catch(() => {
        if (mounted) setError("personalization.loadError");
      })
      .finally(() => {
        if (mounted) setStatus("idle");
      });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(
    () => () => {
      if (cropSource) URL.revokeObjectURL(cropSource);
    },
    [cropSource],
  );

  const update = <Key extends keyof IdentityForm>(key: Key, value: IdentityForm[Key]) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const persist = async (identity: IdentityForm) => {
    setStatus("saving");
    setError(null);
    try {
      const current = await loadPersonalizationPreferences();
      await savePersonalizationPreferences({ ...current, ...identity });
      setForm(identity);
      window.dispatchEvent(new Event("evir:personalization-updated"));
    } catch {
      setError("personalization.saveError");
    } finally {
      setStatus("idle");
    }
  };

  const handleAvatarFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const fileError = validateAvatarFile(file);
    if (fileError) {
      setAvatarError(
        t(
          fileError === "type"
            ? "personalization.avatarTypeError"
            : "personalization.avatarSizeError",
        ),
      );
      return;
    }
    setAvatarError(null);
    setCropSource(URL.createObjectURL(file));
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void persist(form);
  };

  return (
    <SettingsPage>
      <SettingsPageIntro
        eyebrow={t("personalization.identityEyebrow")}
        description={t("personalization.identityPageDescription")}
      />
      <form onSubmit={handleSubmit} className="flex min-w-0 flex-col gap-6">
        <fieldset disabled={status !== "idle"} className="flex min-w-0 flex-col gap-6">
          <SettingsGroup>
            <div className="flex flex-col gap-6 p-4 sm:flex-row sm:gap-8">
              <div className="flex flex-col items-center gap-2.5">
                <button
                  className={`identity-avatar-upload avatar-${form.avatarColor}`}
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  aria-label={t("personalization.uploadAvatar")}
                >
                  {form.avatarImage ? (
                    <img src={form.avatarImage} alt="" />
                  ) : (
                    <span>{Array.from(form.displayName.trim())[0] ?? t("chat.you")}</span>
                  )}
                  <i aria-hidden="true">
                    <Camera size={15} />
                  </i>
                </button>
                <input
                  ref={fileInputRef}
                  className="hidden"
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={handleAvatarFile}
                />
                <SettingsControl className="flex-col items-center gap-1">
                  <Button variant="link" size="sm" onClick={() => fileInputRef.current?.click()}>
                    <ImagePlus size={13} />
                    {form.avatarImage
                      ? t("personalization.replacePhoto")
                      : t("personalization.choosePhoto")}
                  </Button>
                  {form.avatarImage && (
                    <Button
                      variant="ghost-destructive"
                      size="sm"
                      onClick={() =>
                        requestConfirmation(
                          {
                            title: t("confirmation.deleteTitle"),
                            description: t("confirmation.photoDescription"),
                            confirmLabel: t("personalization.removePhoto"),
                            tone: "warning",
                          },
                          () => update("avatarImage", ""),
                        )
                      }
                    >
                      <Trash2 size={13} /> {t("personalization.removePhoto")}
                    </Button>
                  )}
                </SettingsControl>
                <SettingsDescription className="max-w-36 text-center">
                  {t("personalization.avatarHint")}
                </SettingsDescription>
              </div>

              <div className="flex min-w-0 flex-1 flex-col justify-center gap-5">
                <FieldBlock name="displayName">
                  <FormLabel>{t("personalization.displayName")}</FormLabel>
                  <FormControl
                    render={
                      <Input
                        type="text"
                        value={form.displayName}
                        maxLength={40}
                        placeholder={t("personalization.displayNamePlaceholder")}
                        onChange={(event) => update("displayName", event.target.value)}
                      />
                    }
                  />
                  <FormDescription>{t("personalization.displayNameHint")}</FormDescription>
                </FieldBlock>
                {!form.avatarImage && (
                  <div className="avatar-color-field">
                    <span>{t("personalization.fallbackColor")}</span>
                    <div role="radiogroup" aria-label={t("personalization.fallbackColor")}>
                      {AVATAR_COLORS.map((color) => (
                        <Tip key={color} content={t(`personalization.avatarColors.${color}`)}>
                          <button
                            className={`avatar-color-option avatar-${color}${form.avatarColor === color ? " active" : ""}`}
                            type="button"
                            role="radio"
                            aria-checked={form.avatarColor === color}
                            aria-label={t(`personalization.avatarColors.${color}`)}
                            onClick={() => update("avatarColor", color)}
                          />
                        </Tip>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </SettingsGroup>

          {avatarError && <InlineError message={avatarError} />}

          <div className="flex items-start gap-2.5 rounded-xl border border-border bg-surface-subtle p-4">
            <ShieldCheck size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
            <div className="min-w-0">
              <strong className="block text-[12.5px] font-medium text-foreground">
                {t("personalization.localOnly")}
              </strong>
              <span className="mt-0.5 block text-[11px] leading-relaxed text-muted">
                {t("personalization.localOnlyDescription")}
              </span>
            </div>
          </div>

          <div className="flex items-center justify-end gap-2">
            <Button
              variant="secondary"
              onClick={() =>
                requestConfirmation(
                  {
                    title: t("confirmation.resetTitle"),
                    description: t("confirmation.resetDescription", {
                      item: t("settings.identity"),
                    }),
                    confirmLabel: t("personalization.resetIdentity"),
                    tone: "warning",
                  },
                  () => persist({ ...DEFAULT_IDENTITY }),
                )
              }
            >
              {t("personalization.resetIdentity")}
            </Button>
            <Button variant="primary" type="submit">
              {status === "saving"
                ? t("personalization.saving")
                : t("personalization.saveIdentity")}
            </Button>
          </div>
        </fieldset>
        {error && <InlineError message={t(error)} />}
      </form>

      {cropSource && (
        <AvatarCropDialog
          imageUrl={cropSource}
          onCancel={() => setCropSource(null)}
          onSave={(avatarImage) => {
            update("avatarImage", avatarImage);
            setCropSource(null);
          }}
        />
      )}
      {confirmationDialog}
    </SettingsPage>
  );
}
