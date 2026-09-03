import { useRef, type FormEvent, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { ArrowLeft, Check } from "lucide-react";
import { Button, Input, Switch } from "../../components/ui";
import type { ProviderConfigInput } from "../../features/provider/provider-store";
import { SettingsFormDialog } from "../SettingsFormDialog";
import { PROTOCOL_OPTIONS, type FieldErrors, type ProviderField } from "./form-model";

interface ProviderFormDialogProps {
  editing: boolean;
  form: ProviderConfigInput;
  errors: FieldErrors;
  models: string[];
  fetchingModels: boolean;
  testing: boolean;
  testResult: string | null;
  formDirty: boolean;
  onBack: () => void;
  onFieldChange: <Key extends ProviderField>(field: Key, value: ProviderConfigInput[Key]) => void;
  onFetchModels: () => void;
  onTest: () => void;
  onSave: (event: FormEvent<HTMLFormElement>) => void;
  onClose: () => void;
}

function FieldLabel({ text, required }: { text: string; required?: boolean }) {
  return (
    <span className="flex items-center gap-1 text-[11.5px] font-semibold text-foreground">
      {text}
      &nbsp;
      {required && <em className="font-normal text-danger not-italic">*</em>}
    </span>
  );
}

function FieldError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <small className="text-[10.5px] text-danger" role="alert">
      {message}
    </small>
  );
}

const fieldLabelClass = "flex min-w-0 flex-col gap-1.5";
const fieldWideClass = "flex min-w-0 flex-col gap-1.5 max-lg:col-span-full lg:col-span-2";

/**
 * Provider record form (step 2 of setup). Presentational: all state lives in
 * ProviderSettings and flows in through props.
 */
export function ProviderFormDialog({
  editing,
  form,
  errors,
  models,
  fetchingModels,
  testing,
  testResult,
  formDirty,
  onBack,
  onFieldChange,
  onFetchModels,
  onTest,
  onSave,
  onClose,
}: ProviderFormDialogProps) {
  const { t } = useTranslation();
  const protocolButtons = useRef<Array<HTMLButtonElement | null>>([]);
  const fieldError = (field: ProviderField) =>
    errors[field] ? t(`provider.validation.${errors[field]}`) : null;

  // Roving focus for the protocol radio-group (Arrow/Home/End navigation).
  const handleProtocolKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const lastIndex = PROTOCOL_OPTIONS.length - 1;
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      nextIndex = index === lastIndex ? 0 : index + 1;
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      nextIndex = index === 0 ? lastIndex : index - 1;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = lastIndex;
    }
    if (nextIndex === null) return;
    const nextOption = PROTOCOL_OPTIONS[nextIndex];
    if (!nextOption) return;
    event.preventDefault();
    onFieldChange("protocolId", nextOption.id);
    protocolButtons.current[nextIndex]?.focus();
  };

  return (
    <SettingsFormDialog
      title={editing ? t("provider.editProvider") : t("provider.configureProvider")}
      description={t("provider.formDescription")}
      onClose={onClose}
      dirty={formDirty}
      discardPrompt={{
        message: t("provider.discardChangesMessage"),
        keepLabel: t("provider.keepEditing"),
        discardLabel: t("provider.discardChanges"),
      }}
    >
      <form className="flex flex-col gap-3.5 p-5" noValidate onSubmit={onSave}>
        {!editing && (
          <button
            className="flex cursor-pointer items-center gap-1.5 self-start rounded-md p-1.5 px-2 text-[10.5px] text-muted transition-colors hover:bg-surface-hover hover:text-foreground"
            type="button"
            onClick={onBack}
          >
            <ArrowLeft size={13} aria-hidden="true" /> {t("provider.backToPresets")}
          </button>
        )}
        <div className="grid gap-3.5 max-lg:grid-cols-1 lg:grid-cols-2">
          <label className={fieldLabelClass}>
            <FieldLabel text={t("provider.name")} required />
            <Input
              autoFocus
              value={form.name}
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              aria-invalid={Boolean(errors.name)}
              onChange={(event) => onFieldChange("name", event.target.value)}
            />
            <FieldError message={fieldError("name")} />
          </label>
          <fieldset className={`${fieldWideClass} m-0 min-w-0 border-0 p-0`}>
            <legend className="mb-1.5">
              <FieldLabel text={t("provider.protocol")} required />
            </legend>
            <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-1.5">
              {PROTOCOL_OPTIONS.map((option, index) => {
                const selected = form.protocolId === option.id;
                return (
                  <button
                    key={option.id}
                    ref={(element) => {
                      protocolButtons.current[index] = element;
                    }}
                    type="button"
                    aria-pressed={selected}
                    tabIndex={selected ? 0 : -1}
                    onClick={() => onFieldChange("protocolId", option.id)}
                    onKeyDown={(event) => handleProtocolKeyDown(event, index)}
                    className={`flex min-h-8.5 min-w-0 cursor-pointer items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5 text-left text-[11px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus ${
                      selected
                        ? "border-primary bg-primary/[0.07] text-foreground"
                        : "border-border bg-surface text-muted hover:border-border-strong hover:bg-surface-hover hover:text-foreground"
                    }`}
                  >
                    <span>{option.label}</span>
                    {selected && (
                      <Check size={13} aria-hidden="true" className="shrink-0 text-primary" />
                    )}
                  </button>
                );
              })}
            </div>
          </fieldset>
          <label className={fieldWideClass}>
            <FieldLabel text={t("provider.baseUrl")} required />
            <Input
              value={form.baseUrl}
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              aria-invalid={Boolean(errors.baseUrl)}
              placeholder="https://api.example.com/v1"
              onChange={(event) => onFieldChange("baseUrl", event.target.value)}
            />
            <FieldError message={fieldError("baseUrl")} />
          </label>
          <div
            className={`${fieldWideClass} grid min-h-14 grid-cols-[minmax(0,1fr)_auto] items-center gap-3.5 rounded-lg border border-border bg-surface-subtle px-3 py-2.5`}
          >
            <span className="grid min-w-0 gap-0.5">
              <span className="text-[11.5px] font-semibold text-foreground">
                {t("provider.toolCalling")}
              </span>
              <small className="text-[10px] leading-snug text-muted">
                {t("provider.toolCallingDescription")}
              </small>
            </span>
            <Switch
              checked={form.toolCalling}
              onCheckedChange={(checked) => onFieldChange("toolCalling", checked)}
              aria-label={t("provider.toolCalling")}
            />
          </div>
          <label className={fieldWideClass}>
            <FieldLabel text={t("provider.maxContextTokens")} />
            <Input
              type="number"
              min={1024}
              step={1024}
              value={form.maxContextTokens ?? ""}
              onChange={(event) =>
                onFieldChange(
                  "maxContextTokens",
                  event.target.value ? Number(event.target.value) : undefined,
                )
              }
            />
            <small className="text-[10px] text-muted">
              {t("provider.maxContextTokensDescription")}
            </small>
          </label>
          <label className={fieldWideClass}>
            <FieldLabel text={t("provider.apiKey")} required />
            <Input
              type="password"
              autoComplete="off"
              value={form.apiKey}
              aria-invalid={Boolean(errors.apiKey)}
              onChange={(event) => onFieldChange("apiKey", event.target.value)}
            />
            <FieldError message={fieldError("apiKey")} />
          </label>
          <label className={fieldWideClass}>
            <FieldLabel text={t("provider.modelId")} required />
            <div className="flex items-stretch gap-2">
              <Input
                list="provider-model-options"
                value={form.modelId}
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                aria-invalid={Boolean(errors.modelId)}
                onChange={(event) => onFieldChange("modelId", event.target.value)}
              />
              <Button
                variant="secondary"
                size="lg"
                disabled={fetchingModels}
                onClick={onFetchModels}
              >
                {fetchingModels ? t("provider.fetchingModels") : t("provider.fetchModels")}
              </Button>
            </div>
            <FieldError message={fieldError("modelId")} />
            <datalist id="provider-model-options">
              {models.map((model) => (
                <option key={model} value={model} />
              ))}
            </datalist>
          </label>
        </div>
        {testResult && (
          <div
            className="rounded-lg bg-surface-hover px-3 py-2 text-[11.5px] text-muted"
            role="status"
          >
            {testResult}
          </div>
        )}
        <div className="mt-1 grid grid-cols-[auto_1fr_auto_auto] items-center gap-2 border-t border-border pt-3.5 max-sm:grid-cols-2">
          <Button variant="secondary" size="lg" disabled={testing} onClick={onTest}>
            {testing ? "…" : t("provider.testConnection")}
          </Button>
          <span />
          <Button variant="ghost" size="default" type="button" onClick={onClose}>
            {t("provider.cancel")}
          </Button>
          <Button variant="primary" size="lg" type="submit">
            {editing ? t("provider.saveChanges") : t("provider.save")}
          </Button>
        </div>
      </form>
    </SettingsFormDialog>
  );
}
