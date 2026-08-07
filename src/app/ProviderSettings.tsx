import { useMemo, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowLeft,
  Check,
  ChevronRight,
  Pencil,
  Plus,
  Search,
  Server,
  SlidersHorizontal,
  Trash2,
} from "lucide-react";
import { PROVIDER_PRESETS } from "../core/providers/provider-presets";
import type { ProviderPreset, ProviderRegion } from "../core/providers/types";
import {
  providerSchema,
  useProviderStore,
  type ProviderConfigInput,
} from "../features/provider/provider-store";
import { SettingsFormDialog } from "./SettingsFormDialog";
import { useConfirmationDialog } from "./useConfirmationDialog";

type ProviderField = keyof ProviderConfigInput;
type FieldErrors = Partial<Record<ProviderField, "required" | "url">>;
type PresetFilter = "all" | Exclude<ProviderRegion, "custom">;
type DialogStep = "closed" | "presets" | "form";

const SUPPORTED_PROTOCOLS = new Set<ProviderConfigInput["protocolId"]>([
  "openai-chat-completions",
  "openai-compatible-chat",
  "openai-responses",
  "anthropic-messages",
  "gemini-generate-content",
]);

const EMPTY_FORM: ProviderConfigInput = {
  name: "",
  protocolId: "openai-compatible-chat",
  baseUrl: "",
  apiKey: "",
  modelId: "",
  toolCalling: false,
};

function supportedProtocol(preset: ProviderPreset): ProviderConfigInput["protocolId"] | null {
  if (SUPPORTED_PROTOCOLS.has(preset.recommendedProtocol as ProviderConfigInput["protocolId"])) {
    return preset.recommendedProtocol as ProviderConfigInput["protocolId"];
  }
  return (
    (preset.protocols.find((protocol) =>
      SUPPORTED_PROTOCOLS.has(protocol as ProviderConfigInput["protocolId"]),
    ) as ProviderConfigInput["protocolId"] | undefined) ?? null
  );
}

function validationErrors(form: ProviderConfigInput, required?: ProviderField[]): FieldErrors {
  const result = providerSchema.safeParse(form);
  if (result.success) return {};
  const fields = required ? new Set(required) : null;
  const errors: FieldErrors = {};
  for (const field of ["name", "baseUrl", "apiKey", "modelId"] as const) {
    if ((!fields || fields.has(field)) && !form[field].trim()) errors[field] = "required";
  }
  for (const issue of result.error.issues) {
    const field = issue.path[0];
    if (typeof field !== "string" || (fields && !fields.has(field as ProviderField))) continue;
    const typed = field as ProviderField;
    if (!errors[typed]) errors[typed] = issue.code === "invalid_format" ? "url" : "required";
  }
  return errors;
}

const providerInitial = (name: string) => name.trim().slice(0, 1).toUpperCase();

export function ProviderSettings() {
  const { t } = useTranslation();
  const { requestConfirmation, confirmationDialog } = useConfirmationDialog();
  const {
    providers,
    addProvider,
    updateProvider,
    deleteProvider,
    setDefaultProvider,
    testConnection,
    fetchModels,
  } = useProviderStore();
  const presets = useMemo(
    () =>
      PROVIDER_PRESETS.filter(
        (preset) => supportedProtocol(preset) !== null && preset.endpoints.length > 0,
      ),
    [],
  );
  const [step, setStep] = useState<DialogStep>("closed");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selectedPresetId, setSelectedPresetId] = useState<string | null>(null);
  const [presetFilter, setPresetFilter] = useState<PresetFilter>("all");
  const [presetQuery, setPresetQuery] = useState("");
  const [form, setForm] = useState<ProviderConfigInput>({ ...EMPTY_FORM });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [models, setModels] = useState<string[]>([]);
  const [fetchingModels, setFetchingModels] = useState(false);

  const resetDialog = () => {
    setStep("closed");
    setEditingId(null);
    setSelectedPresetId(null);
    setPresetQuery("");
    setForm({ ...EMPTY_FORM });
    setErrors({});
    setTestResult(null);
    setModels([]);
  };

  const openAdd = () => {
    resetDialog();
    setStep("presets");
  };

  const openEdit = (id: string) => {
    const provider = providers.find((item) => item.id === id);
    if (!provider) return;
    setEditingId(id);
    setSelectedPresetId(null);
    setForm({
      name: provider.name,
      protocolId: provider.protocolId as ProviderConfigInput["protocolId"],
      baseUrl: provider.baseUrl,
      apiKey: provider.apiKey,
      modelId: provider.modelId,
      toolCalling: provider.modelCapabilities?.toolCalling ?? false,
      maxContextTokens: provider.modelCapabilities?.maxContextTokens,
    });
    setErrors({});
    setTestResult(null);
    setModels([]);
    setStep("form");
  };

  const choosePreset = (preset: ProviderPreset | null) => {
    if (!preset) {
      setSelectedPresetId("custom");
      setForm({ ...EMPTY_FORM });
    } else {
      const protocolId = supportedProtocol(preset);
      if (!protocolId) return;
      setSelectedPresetId(preset.id);
      setForm({
        ...EMPTY_FORM,
        name: preset.name,
        protocolId,
        baseUrl: preset.endpoints[0]?.baseUrl ?? "",
      });
    }
    setErrors({});
    setStep("form");
  };

  const updateField = <Key extends ProviderField>(field: Key, value: ProviderConfigInput[Key]) => {
    setForm((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
    setTestResult(null);
  };

  const fieldError = (field: ProviderField) =>
    errors[field] ? t(`provider.validation.${errors[field]}`) : null;

  const handleSave = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextErrors = validationErrors(form);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;
    try {
      if (editingId) await updateProvider(editingId, form);
      else await addProvider(form);
      resetDialog();
    } catch (error) {
      setTestResult(error instanceof Error ? error.message : String(error));
    }
  };

  const handleTest = async () => {
    const nextErrors = validationErrors(form, ["baseUrl", "apiKey", "modelId"]);
    if (Object.keys(nextErrors).length) {
      setErrors((current) => ({ ...current, ...nextErrors }));
      return;
    }
    setTesting(true);
    try {
      const result = await testConnection(form);
      setTestResult(
        result.ok
          ? t("provider.connectionSuccess")
          : `${t("provider.connectionFailed")}: ${result.error?.message ?? ""}`,
      );
    } catch (error) {
      setTestResult(error instanceof Error ? error.message : String(error));
    } finally {
      setTesting(false);
    }
  };

  const handleFetchModels = async () => {
    const nextErrors = validationErrors(form, ["baseUrl", "apiKey"]);
    if (Object.keys(nextErrors).length) {
      setErrors((current) => ({ ...current, ...nextErrors }));
      return;
    }
    setFetchingModels(true);
    const discovered = await fetchModels(form);
    setModels(discovered);
    setTestResult(discovered.length ? null : t("provider.fetchModelsFailed"));
    setFetchingModels(false);
  };

  const filteredPresets = presets.filter((preset) => {
    const query = presetQuery.trim().toLowerCase();
    return (
      (presetFilter === "all" || preset.region === presetFilter) &&
      (!query || preset.name.toLowerCase().includes(query))
    );
  });

  return (
    <div className="provider-settings">
      <div className="settings-page-intro compact">
        <div>
          <span className="settings-page-eyebrow">
            {t("settingsDescriptions.modelConnections")}
          </span>
          <p>{t("provider.addDescription")}</p>
        </div>
        <span className="settings-count-badge">
          {t("settingsDescriptions.providerCount", { count: providers.length })}
        </span>
      </div>

      {providers.length ? (
        <section className="provider-connections" aria-label={t("provider.configured")}>
          <div className="provider-section-heading">
            <div>
              <h4>{t("provider.configured")}</h4>
              <span>{t("provider.configuredDescription")}</span>
            </div>
            <button className="secondary-button" type="button" onClick={openAdd}>
              <Plus size={14} /> {t("provider.add")}
            </button>
          </div>
          <div className="provider-connection-list">
            {providers.map((provider) => (
              <article className="provider-connection-row" key={provider.id}>
                <span className="provider-monogram" aria-hidden="true">
                  {providerInitial(provider.name)}
                </span>
                <div className="provider-connection-copy">
                  <strong>{provider.name}</strong>
                  <span>
                    {provider.modelId} · {provider.protocolId}
                  </span>
                </div>
                {provider.isDefault && (
                  <span className="provider-default-badge">{t("provider.default")}</span>
                )}
                <div className="provider-connection-actions">
                  {!provider.isDefault && (
                    <button type="button" onClick={() => void setDefaultProvider(provider.id)}>
                      {t("provider.setDefault")}
                    </button>
                  )}
                  <button type="button" onClick={() => openEdit(provider.id)}>
                    <Pencil size={13} /> <span>{t("provider.edit")}</span>
                  </button>
                  <button
                    type="button"
                    aria-label={t("provider.delete")}
                    title={t("provider.delete")}
                    onClick={() =>
                      requestConfirmation(
                        {
                          title: t("confirmation.deleteTitle"),
                          description: t("confirmation.deleteDescription", {
                            item: provider.name,
                          }),
                          confirmLabel: t("provider.delete"),
                        },
                        () => deleteProvider(provider.id),
                      )
                    }
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>
      ) : (
        <div className="provider-empty-panel">
          <div className="provider-empty-panel-icon" aria-hidden="true">
            <Server size={20} />
          </div>
          <strong>{t("provider.noProviders")}</strong>
          <p>{t("provider.addDescription")}</p>
          <button type="button" onClick={openAdd}>
            <Plus size={15} /> {t("provider.add")}
          </button>
        </div>
      )}

      {step === "presets" && (
        <SettingsFormDialog
          title={t("provider.chooseProvider")}
          description={t("provider.presetsDescription")}
          onClose={resetDialog}
          wide
        >
          <div className="provider-catalog-toolbar">
            <div className="provider-region-tabs" role="group" aria-label={t("provider.region")}>
              {(["all", "international", "china", "local"] as const).map((region) => (
                <button
                  type="button"
                  key={region}
                  className={presetFilter === region ? "active" : ""}
                  aria-pressed={presetFilter === region}
                  onClick={() => setPresetFilter(region)}
                >
                  {t(`provider.regions.${region}`)}
                </button>
              ))}
            </div>
            <label className="provider-preset-search">
              <Search size={14} />
              <input
                type="search"
                value={presetQuery}
                placeholder={t("provider.searchPresets")}
                aria-label={t("provider.searchPresets")}
                onChange={(event) => setPresetQuery(event.target.value)}
              />
            </label>
          </div>
          <div className="provider-preset-grid">
            <button
              className="provider-preset-tile custom"
              type="button"
              onClick={() => choosePreset(null)}
            >
              <SlidersHorizontal size={16} />
              <span>
                <strong>{t("provider.custom")}</strong>
                <small>{t("provider.customDescription")}</small>
              </span>
              <ChevronRight size={14} />
            </button>
            {filteredPresets.map((preset) => (
              <button
                className="provider-preset-tile"
                type="button"
                key={preset.id}
                onClick={() => choosePreset(preset)}
              >
                <span className="provider-preset-mark">{providerInitial(preset.name)}</span>
                <span>
                  <strong>{preset.name}</strong>
                  <small>{t(`provider.regions.${preset.region}`)}</small>
                </span>
                {selectedPresetId === preset.id ? <Check size={14} /> : <ChevronRight size={14} />}
              </button>
            ))}
          </div>
        </SettingsFormDialog>
      )}

      {step === "form" && (
        <SettingsFormDialog
          title={editingId ? t("provider.editProvider") : t("provider.configureProvider")}
          description={t("provider.formDescription")}
          onClose={resetDialog}
        >
          <form
            className="provider-form modal-form"
            noValidate
            onSubmit={(event) => void handleSave(event)}
          >
            {!editingId && (
              <button
                className="dialog-back-button"
                type="button"
                onClick={() => setStep("presets")}
              >
                <ArrowLeft size={14} /> {t("provider.backToPresets")}
              </button>
            )}
            <div className="provider-form-grid">
              <label>
                <span>
                  {t("provider.name")} <em>*</em>
                </span>
                <input
                  autoFocus
                  value={form.name}
                  aria-invalid={Boolean(errors.name)}
                  onChange={(event) => updateField("name", event.target.value)}
                />
                {fieldError("name") && <small className="field-error">{fieldError("name")}</small>}
              </label>
              <label>
                <span>
                  {t("provider.protocol")} <em>*</em>
                </span>
                <select
                  value={form.protocolId}
                  onChange={(event) =>
                    updateField(
                      "protocolId",
                      event.target.value as ProviderConfigInput["protocolId"],
                    )
                  }
                >
                  <option value="openai-chat-completions">OpenAI Chat Completions</option>
                  <option value="openai-compatible-chat">OpenAI Compatible</option>
                  <option value="openai-responses">OpenAI Responses</option>
                  <option value="anthropic-messages">Anthropic Messages</option>
                  <option value="gemini-generate-content">Gemini GenerateContent</option>
                </select>
              </label>
              <label className="provider-field-wide">
                <span>
                  {t("provider.baseUrl")} <em>*</em>
                </span>
                <input
                  value={form.baseUrl}
                  aria-invalid={Boolean(errors.baseUrl)}
                  placeholder="https://api.example.com/v1"
                  onChange={(event) => updateField("baseUrl", event.target.value)}
                />
                {fieldError("baseUrl") && (
                  <small className="field-error">{fieldError("baseUrl")}</small>
                )}
              </label>
              <label className="provider-field-wide provider-capability-toggle">
                <input
                  type="checkbox"
                  checked={form.toolCalling}
                  onChange={(event) => updateField("toolCalling", event.target.checked)}
                />
                <span>
                  <strong>{t("provider.toolCalling")}</strong>
                  <small>{t("provider.toolCallingDescription")}</small>
                </span>
                <i className="provider-capability-switch" aria-hidden="true" />
              </label>
              <label className="provider-field-wide">
                <span>{t("provider.maxContextTokens")}</span>
                <input
                  type="number"
                  min={1024}
                  step={1024}
                  value={form.maxContextTokens ?? ""}
                  onChange={(event) =>
                    updateField(
                      "maxContextTokens",
                      event.target.value ? Number(event.target.value) : undefined,
                    )
                  }
                />
                <small>{t("provider.maxContextTokensDescription")}</small>
              </label>
              <label className="provider-field-wide">
                <span>
                  {t("provider.apiKey")} <em>*</em>
                </span>
                <input
                  type="password"
                  autoComplete="off"
                  value={form.apiKey}
                  aria-invalid={Boolean(errors.apiKey)}
                  onChange={(event) => updateField("apiKey", event.target.value)}
                />
                {fieldError("apiKey") && (
                  <small className="field-error">{fieldError("apiKey")}</small>
                )}
              </label>
              <label className="provider-field-wide">
                <span>
                  {t("provider.modelId")} <em>*</em>
                </span>
                <div className="model-input-row">
                  <input
                    list="provider-model-options"
                    value={form.modelId}
                    aria-invalid={Boolean(errors.modelId)}
                    onChange={(event) => updateField("modelId", event.target.value)}
                  />
                  <button
                    className="secondary-button"
                    type="button"
                    disabled={fetchingModels}
                    onClick={() => void handleFetchModels()}
                  >
                    {fetchingModels ? t("provider.fetchingModels") : t("provider.fetchModels")}
                  </button>
                </div>
                {fieldError("modelId") && (
                  <small className="field-error">{fieldError("modelId")}</small>
                )}
                <datalist id="provider-model-options">
                  {models.map((model) => (
                    <option key={model} value={model} />
                  ))}
                </datalist>
              </label>
            </div>
            {testResult && (
              <div className="form-message" role="status">
                {testResult}
              </div>
            )}
            <div className="form-actions dialog-form-actions">
              <button
                className="secondary-button"
                type="button"
                disabled={testing}
                onClick={() => void handleTest()}
              >
                {testing ? "…" : t("provider.testConnection")}
              </button>
              <span />
              <button className="text-button" type="button" onClick={resetDialog}>
                {t("provider.cancel")}
              </button>
              <button className="primary-button" type="submit">
                {editingId ? t("provider.saveChanges") : t("provider.save")}
              </button>
            </div>
          </form>
        </SettingsFormDialog>
      )}
      {confirmationDialog}
    </div>
  );
}
