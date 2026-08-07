import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Camera, ImagePlus, ShieldCheck, Trash2, UserRound } from "lucide-react";
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
    <section className="local-identity-settings">
      <div className="identity-page-intro">
        <span className="identity-page-icon" aria-hidden="true">
          <UserRound size={20} />
        </span>
        <div>
          <span className="settings-page-eyebrow">{t("personalization.identityEyebrow")}</span>
          <h3>{t("personalization.identity")}</h3>
          <p>{t("personalization.identityPageDescription")}</p>
        </div>
      </div>

      <form onSubmit={handleSubmit}>
        <fieldset disabled={status !== "idle"}>
          <section className="identity-workspace">
            <div className="identity-avatar-column">
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
              <div className="identity-avatar-actions">
                <button type="button" onClick={() => fileInputRef.current?.click()}>
                  <ImagePlus size={13} />
                  {form.avatarImage
                    ? t("personalization.replacePhoto")
                    : t("personalization.choosePhoto")}
                </button>
                {form.avatarImage && (
                  <button
                    className="danger"
                    type="button"
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
                  </button>
                )}
              </div>
              <small>{t("personalization.avatarHint")}</small>
            </div>

            <div className="identity-details-column">
              <label className="identity-name-field">
                <span>{t("personalization.displayName")}</span>
                <input
                  type="text"
                  value={form.displayName}
                  maxLength={40}
                  placeholder={t("personalization.displayNamePlaceholder")}
                  onChange={(event) => update("displayName", event.target.value)}
                />
                <small>{t("personalization.displayNameHint")}</small>
              </label>
              {!form.avatarImage && (
                <div className="avatar-color-field">
                  <span>{t("personalization.fallbackColor")}</span>
                  <div role="radiogroup" aria-label={t("personalization.fallbackColor")}>
                    {AVATAR_COLORS.map((color) => (
                      <button
                        className={`avatar-color-option avatar-${color}${form.avatarColor === color ? " active" : ""}`}
                        type="button"
                        role="radio"
                        aria-checked={form.avatarColor === color}
                        aria-label={t(`personalization.avatarColors.${color}`)}
                        title={t(`personalization.avatarColors.${color}`)}
                        key={color}
                        onClick={() => update("avatarColor", color)}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>
          </section>

          {avatarError && (
            <p className="identity-avatar-error" role="alert">
              {avatarError}
            </p>
          )}

          <div className="identity-privacy-note">
            <ShieldCheck size={15} aria-hidden="true" />
            <div>
              <strong>{t("personalization.localOnly")}</strong>
              <span>{t("personalization.localOnlyDescription")}</span>
            </div>
          </div>

          <div className="identity-page-actions">
            <button
              type="button"
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
            </button>
            <button className="primary-button" type="submit">
              {status === "saving"
                ? t("personalization.saving")
                : t("personalization.saveIdentity")}
            </button>
          </div>
        </fieldset>
        {error && (
          <p className="personalization-error" role="alert">
            {t(error)}
          </p>
        )}
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
    </section>
  );
}
