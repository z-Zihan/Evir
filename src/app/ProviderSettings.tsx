import { useMemo, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import {
  Check,
  ChevronRight,
  Globe2,
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

type ProviderField = keyof ProviderConfigInput;
type FieldErrors = Partial<Record<ProviderField, string>>;
type PresetFilter = "all" | Exclude<ProviderRegion, "custom">;

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
};

function supportedProtocol(preset: ProviderPreset): ProviderConfigInput["protocolId"] | null {
  const preferred = preset.recommendedProtocol;
  if (SUPPORTED_PROTOCOLS.has(preferred as ProviderConfigInput["protocolId"])) {
    return preferred as ProviderConfigInput["protocolId"];
  }
  return (
    (preset.protocols.find((protocol) =>
      SUPPORTED_PROTOCOLS.has(protocol as ProviderConfigInput["protocolId"]),
    ) as ProviderConfigInput["protocolId"] | undefined) ?? null
  );
}

function availablePresets(): ProviderPreset[] {
  return PROVIDER_PRESETS.filter(
    (preset) => supportedProtocol(preset) !== null && preset.endpoints.length > 0,
  );
}

function validationErrors(
  form: ProviderConfigInput,
  requiredFields?: ProviderField[],
): FieldErrors {
  const result = providerSchema.safeParse(form);
  if (result.success) return {};
  const fields = requiredFields ? new Set(requiredFields) : null;
  const errors: FieldErrors = {};
  for (const issue of result.error.issues) {
    const field = issue.path[0];
    if (typeof field !== "string" || (fields && !fields.has(field as ProviderField))) continue;
    const typedField = field as ProviderField;
    if (errors[typedField]) continue;
    errors[typedField] = issue.code === "invalid_format" ? "url" : "required";
  }
  return errors;
}

function providerInitial(name: string): string {
  return name.trim().slice(0, 1).toUpperCase();
}

export function ProviderSettings() {
  const { t } = useTranslation();
  const {
    providers,
    addProvider,
    deleteProvider,
    setDefaultProvider,
    testConnection,
    fetchModels,
  } = useProviderStore();
  const presets = useMemo(() => availablePresets(), []);
  const [showForm, setShowForm] = useState(false);
  const [selectedPresetId, setSelectedPresetId] = useState<string>("custom");
  const [presetFilter, setPresetFilter] = useState<PresetFilter>("all");
  const [presetQuery, setPresetQuery] = useState("");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [models, setModels] = useState<string[]>([]);
  const [fetchingModels, setFetchingModels] = useState(false);
  const [modelFetchError, setModelFetchError] = useState<string | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [form, setForm] = useState<ProviderConfigInput>({ ...EMPTY_FORM });

  const filteredPresets = presets.filter((preset) => {
    const matchesRegion = presetFilter === "all" || preset.region === presetFilter;
    const matchesQuery = preset.name.toLowerCase().includes(presetQuery.trim().toLowerCase());
    return matchesRegion && matchesQuery;
  });

  const updateField = <Key extends ProviderField>(field: Key, value: ProviderConfigInput[Key]) => {
    setForm((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
    setTestResult(null);
  };

  const validateField = (field: ProviderField) => {
    const next = validationErrors(form, [field]);
    setErrors((current) => ({ ...current, [field]: next[field] }));
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
    setModels([]);
    setModelFetchError(null);
    setTestResult(null);
    setShowForm(true);
  };

  const handleTest = async () => {
    const required: ProviderField[] = ["baseUrl", "apiKey", "modelId"];
    const nextErrors = validationErrors(form, required);
    if (Object.keys(nextErrors).length > 0) {
      setErrors((current) => ({ ...current, ...nextErrors }));
      return;
    }
    setTesting(true);
    setTestResult(null);
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

  const handleSave = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextErrors = validationErrors(form);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;
    try {
      await addProvider(form);
      setShowForm(false);
      setSelectedPresetId("custom");
      setForm({ ...EMPTY_FORM });
      setTestResult(null);
      setModels([]);
      setModelFetchError(null);
    } catch (error) {
      setTestResult(error instanceof Error ? error.message : String(error));
    }
  };

  const handleFetchModels = async () => {
    const required: ProviderField[] = ["baseUrl", "apiKey"];
    const nextErrors = validationErrors(form, required);
    if (Object.keys(nextErrors).length > 0) {
      setErrors((current) => ({ ...current, ...nextErrors }));
      return;
    }
    setFetchingModels(true);
    setModelFetchError(null);
    const discoveredModels = await fetchModels(form);
    setModels(discoveredModels);
    if (discoveredModels.length === 0) setModelFetchError(t("provider.fetchModelsFailed"));
    setFetchingModels(false);
  };

  const fieldError = (field: ProviderField) =>
    errors[field] ? t(`provider.validation.${errors[field]}`) : null;

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

      {providers.length > 0 && (
        <section className="provider-connections" aria-label={t("provider.configured")}>
          <div className="provider-section-heading">
            <div>
              <h4>{t("provider.configured")}</h4>
              <span>{t("provider.configuredDescription")}</span>
            </div>
            <button className="secondary-button" type="button" onClick={() => choosePreset(null)}>
              <Plus size={14} />
              {t("provider.add")}
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
                  <button
                    type="button"
                    aria-label={t("provider.delete")}
                    onClick={() => void deleteProvider(provider.id)}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

      <section className="provider-preset-section">
        <div className="provider-section-heading">
          <div>
            <h4>{t("provider.presets")}</h4>
            <span>{t("provider.presetsDescription")}</span>
          </div>
          <label className="provider-preset-search">
            <Search size={13} aria-hidden="true" />
            <span className="sr-only">{t("provider.searchPresets")}</span>
            <input
              type="search"
              value={presetQuery}
              placeholder={t("provider.searchPresets")}
              onChange={(event) => setPresetQuery(event.target.value)}
            />
          </label>
        </div>
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
        <div className="provider-preset-grid">
          <button
            className={`provider-preset-tile custom ${selectedPresetId === "custom" ? "selected" : ""}`}
            type="button"
            onClick={() => choosePreset(null)}
          >
            <SlidersHorizontal size={16} aria-hidden="true" />
            <span>
              <strong>{t("provider.custom")}</strong>
              <small>{t("provider.customDescription")}</small>
            </span>
            <ChevronRight size={14} aria-hidden="true" />
          </button>
          {filteredPresets.map((preset) => (
            <button
              className={`provider-preset-tile ${selectedPresetId === preset.id ? "selected" : ""}`}
              type="button"
              key={preset.id}
              onClick={() => choosePreset(preset)}
            >
              <span className="provider-preset-mark" aria-hidden="true">
                {providerInitial(preset.name)}
              </span>
              <span>
                <strong>{preset.name}</strong>
                <small>{t(`provider.regions.${preset.region}`)}</small>
              </span>
              {selectedPresetId === preset.id ? <Check size={14} /> : <ChevronRight size={14} />}
            </button>
          ))}
        </div>
      </section>

      {showForm && (
        <form className="provider-form" noValidate onSubmit={(event) => void handleSave(event)}>
          <div className="provider-form-heading">
            <div>
              <h4>{form.name || t("provider.custom")}</h4>
              <span>{t("provider.formDescription")}</span>
            </div>
            <Globe2 size={18} aria-hidden="true" />
          </div>
          <div className="provider-form-grid">
            <label>
              <span>
                {t("provider.name")} <em>*</em>
              </span>
              <input
                value={form.name}
                aria-invalid={Boolean(errors.name)}
                onBlur={() => validateField("name")}
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
                  updateField("protocolId", event.target.value as ProviderConfigInput["protocolId"])
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
                onBlur={() => validateField("baseUrl")}
                onChange={(event) => updateField("baseUrl", event.target.value)}
              />
              {fieldError("baseUrl") && (
                <small className="field-error">{fieldError("baseUrl")}</small>
              )}
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
                onBlur={() => validateField("apiKey")}
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
                  list="model-options"
                  value={form.modelId}
                  aria-invalid={Boolean(errors.modelId)}
                  onBlur={() => validateField("modelId")}
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
              <datalist id="model-options">
                {models.map((model) => (
                  <option key={model} value={model} />
                ))}
              </datalist>
            </label>
          </div>
          {modelFetchError && (
            <div className="form-message" role="status">
              {modelFetchError}
            </div>
          )}
          {testResult && (
            <div className="form-message" role="status">
              {testResult}
            </div>
          )}
          <div className="form-actions">
            <button className="primary-button" type="submit">
              {t("provider.save")}
            </button>
            <button
              className="secondary-button"
              type="button"
              disabled={testing}
              onClick={() => void handleTest()}
            >
              {testing ? "…" : t("provider.testConnection")}
            </button>
            <button
              className="text-button"
              type="button"
              onClick={() => {
                setShowForm(false);
                setErrors({});
                setTestResult(null);
                setModels([]);
                setModelFetchError(null);
              }}
            >
              {t("provider.cancel")}
            </button>
          </div>
        </form>
      )}

      {providers.length === 0 && !showForm && (
        <div className="provider-guidance">
          <Server size={15} aria-hidden="true" />
          <span>{t("provider.addFirst")}</span>
        </div>
      )}
    </div>
  );
}
