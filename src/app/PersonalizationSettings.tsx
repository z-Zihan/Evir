import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import {
  AlignLeft,
  Camera,
  ImagePlus,
  Languages,
  MessageSquareText,
  ShieldCheck,
  Trash2,
  UserRound,
} from "lucide-react";
import {
  DEFAULT_PERSONALIZATION_PREFERENCES,
  AVATAR_COLORS,
  type PersonalizationPreferences,
} from "../core/personalization/types";
import {
  loadPersonalizationPreferences,
  savePersonalizationPreferences,
} from "../features/settings/personalization-settings";
import { AvatarCropDialog } from "./AvatarCropDialog";
import { validateAvatarFile } from "./avatar-image";

type FormStatus = "idle" | "loading" | "saving";
type FormError = "load" | "save" | null;

export function PersonalizationPanel() {
  const { t } = useTranslation();
  const [form, setForm] = useState<PersonalizationPreferences>({
    ...DEFAULT_PERSONALIZATION_PREFERENCES,
  });
  const [status, setStatus] = useState<FormStatus>("loading");
  const [error, setError] = useState<FormError>(null);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const [cropSource, setCropSource] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  useEffect(
    () => () => {
      if (cropSource) URL.revokeObjectURL(cropSource);
    },
    [cropSource],
  );

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
      window.dispatchEvent(new Event("evir:personalization-updated"));
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

  const handleAvatarFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const fileError = validateAvatarFile(file);
    if (fileError === "type") {
      setAvatarError(t("personalization.avatarTypeError"));
      return;
    }
    if (fileError === "size") {
      setAvatarError(t("personalization.avatarSizeError"));
      return;
    }
    setAvatarError(null);
    setCropSource(URL.createObjectURL(file));
  };

  const closeCropDialog = () => {
    setCropSource(null);
  };

  const handleCroppedAvatar = (avatarImage: string) => {
    update("avatarImage", avatarImage);
    closeCropDialog();
  };

  return (
    <section className="personalization-settings">
      <form onSubmit={handleSubmit}>
        <div className="personalization-overview">
          <div className="personalization-overview-icon" aria-hidden="true">
            <UserRound size={19} />
          </div>
          <div>
            <span className="settings-page-eyebrow">
              {t("settingsDescriptions.responsePreferences")}
            </span>
            <h3>{t("personalization.title")}</h3>
            <p>{t("settingsDescriptions.personalization")}</p>
          </div>
          <label className="personalization-master-toggle">
            <span>
              <strong>{t("personalization.enable")}</strong>
              <small>{form.enabled ? t("personalization.on") : t("personalization.off")}</small>
            </span>
            <input
              type="checkbox"
              checked={form.enabled}
              disabled={status !== "idle"}
              onChange={(event) => update("enabled", event.target.checked)}
            />
            <i aria-hidden="true" />
          </label>
        </div>

        <fieldset disabled={status !== "idle"}>
          <section className="personalization-section identity-section">
            <div className="personalization-section-heading">
              <UserRound size={15} aria-hidden="true" />
              <div>
                <h4>{t("personalization.identity")}</h4>
                <p>{t("personalization.identityDescription")}</p>
              </div>
            </div>
            <div className="identity-profile-editor">
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
                      onClick={() => update("avatarImage", "")}
                    >
                      <Trash2 size={13} /> {t("personalization.removePhoto")}
                    </button>
                  )}
                </div>
                <small>{t("personalization.avatarHint")}</small>
              </div>
              <div className="identity-details-column">
                <label className="personalization-name-field">
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
                          key={color}
                          onClick={() => update("avatarColor", color)}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
            {avatarError && (
              <p className="identity-avatar-error" role="alert">
                {avatarError}
              </p>
            )}
          </section>

          <section className="personalization-section">
            <div className="personalization-section-heading">
              <Languages size={15} aria-hidden="true" />
              <div>
                <h4>{t("personalization.responseLanguage")}</h4>
                <p>{t("personalization.languageDescription")}</p>
              </div>
            </div>
            <div className="preference-choice-row">
              {(["follow-app", "zh-CN", "en"] as const).map((value) => (
                <button
                  type="button"
                  key={value}
                  className={form.responseLanguage === value ? "active" : ""}
                  aria-pressed={form.responseLanguage === value}
                  onClick={() => update("responseLanguage", value)}
                >
                  <strong>{t(`personalization.languageOptions.${value}.label`)}</strong>
                  <span>{t(`personalization.languageOptions.${value}.description`)}</span>
                </button>
              ))}
            </div>
          </section>

          <div className="personalization-two-column">
            <section className="personalization-section">
              <div className="personalization-section-heading">
                <AlignLeft size={15} aria-hidden="true" />
                <div>
                  <h4>{t("personalization.detailLevel")}</h4>
                  <p>{t("personalization.detailDescription")}</p>
                </div>
              </div>
              <div className="preference-stack">
                {(["concise", "balanced", "detailed"] as const).map((value) => (
                  <button
                    type="button"
                    key={value}
                    className={form.detailLevel === value ? "active" : ""}
                    onClick={() => update("detailLevel", value)}
                  >
                    <span aria-hidden="true" className={`detail-lines ${value}`}>
                      <i />
                      <i />
                      <i />
                    </span>
                    <span>
                      <strong>{t(`personalization.${value}`)}</strong>
                      <small>{t(`personalization.detailOptions.${value}`)}</small>
                    </span>
                  </button>
                ))}
              </div>
            </section>

            <section className="personalization-section">
              <div className="personalization-section-heading">
                <MessageSquareText size={15} aria-hidden="true" />
                <div>
                  <h4>{t("personalization.style")}</h4>
                  <p>{t("personalization.styleDescription")}</p>
                </div>
              </div>
              <div className="preference-stack">
                {(["professional", "casual", "academic"] as const).map((value) => (
                  <button
                    type="button"
                    key={value}
                    className={form.style === value ? "active" : ""}
                    onClick={() => update("style", value)}
                  >
                    <span className="preference-radio" aria-hidden="true" />
                    <span>
                      <strong>{t(`personalization.${value}`)}</strong>
                      <small>{t(`personalization.styleOptions.${value}`)}</small>
                    </span>
                  </button>
                ))}
              </div>
            </section>
          </div>

          <section className="personalization-section instructions-section">
            <div className="personalization-section-heading">
              <ShieldCheck size={15} aria-hidden="true" />
              <div>
                <h4>{t("personalization.customInstructions")}</h4>
                <p>{t("personalization.instructionsDescription")}</p>
              </div>
            </div>
            <label>
              <textarea
                value={form.customInstructions}
                maxLength={2000}
                rows={7}
                placeholder={t("personalization.instructionsPlaceholder")}
                onChange={(event) => update("customInstructions", event.target.value)}
              />
              <span className="personalization-counter">
                {form.customInstructions.length} / 2000
              </span>
            </label>
          </section>

          <div className="personalization-actions">
            <span>{t("personalization.localNote")}</span>
            <div>
              <button type="button" onClick={handleReset}>
                {t("personalization.reset")}
              </button>
              <button type="submit">
                {status === "saving" ? t("personalization.saving") : t("personalization.save")}
              </button>
            </div>
          </div>
        </fieldset>
        {error && (
          <p className="personalization-error" role="alert">
            {t(`personalization.${error}Error`)}
          </p>
        )}
      </form>
      {cropSource && (
        <AvatarCropDialog
          imageUrl={cropSource}
          onCancel={closeCropDialog}
          onSave={handleCroppedAvatar}
        />
      )}
    </section>
  );
}
