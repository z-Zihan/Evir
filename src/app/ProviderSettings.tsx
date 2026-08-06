import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useProviderStore, type ProviderConfigInput } from "../features/provider/provider-store";

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
  const [showForm, setShowForm] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [models, setModels] = useState<string[]>([]);
  const [fetchingModels, setFetchingModels] = useState(false);
  const [modelFetchError, setModelFetchError] = useState<string | null>(null);
  const [form, setForm] = useState<ProviderConfigInput>({
    name: "",
    protocolId: "openai-compatible-chat",
    baseUrl: "https://api.deepseek.com",
    apiKey: "",
    modelId: "",
  });

  const handleTest = async () => {
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
    }
    setTesting(false);
  };

  const handleSave = async () => {
    try {
      await addProvider(form);
      setShowForm(false);
      setForm({
        name: "",
        protocolId: "openai-compatible-chat",
        baseUrl: "https://api.deepseek.com",
        apiKey: "",
        modelId: "",
      });
      setTestResult(null);
      setModels([]);
      setModelFetchError(null);
    } catch (error) {
      setTestResult(error instanceof Error ? error.message : String(error));
    }
  };

  const handleFetchModels = async () => {
    setFetchingModels(true);
    setModelFetchError(null);
    const discoveredModels = await fetchModels(form);
    setModels(discoveredModels);
    if (discoveredModels.length === 0) setModelFetchError(t("provider.fetchModelsFailed"));
    setFetchingModels(false);
  };

  return (
    <div className="flex flex-col gap-3">
      {providers.length > 0 && (
        <div className="provider-list">
          {providers.map((p) => (
            <div key={p.id} className="provider-item">
              <div className="provider-info">
                <strong>{p.name}</strong>
                <span className="provider-meta">
                  {p.modelId} · {p.protocolId}
                </span>
                {p.isDefault && <span className="badge">{t("provider.default")}</span>}
              </div>
              <div className="provider-actions">
                {!p.isDefault && (
                  <button type="button" onClick={() => void setDefaultProvider(p.id)}>
                    {t("provider.setDefault")}
                  </button>
                )}
                <button type="button" onClick={() => void deleteProvider(p.id)}>
                  {t("provider.delete")}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      {showForm ? (
        <div className="provider-form">
          <label>
            {t("provider.name")}
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </label>
          <label>
            {t("provider.protocol")}
            <select
              value={form.protocolId}
              onChange={(e) =>
                setForm({
                  ...form,
                  protocolId: e.target.value as ProviderConfigInput["protocolId"],
                })
              }
            >
              <option value="openai-chat-completions">OpenAI Chat Completions</option>
              <option value="openai-compatible-chat">OpenAI Compatible</option>
              <option value="openai-responses">OpenAI Responses</option>
              <option value="anthropic-messages">Anthropic Messages</option>
              <option value="gemini-generate-content">Gemini GenerateContent</option>
            </select>
          </label>
          <label>
            {t("provider.baseUrl")}
            <input
              value={form.baseUrl}
              onChange={(e) => setForm({ ...form, baseUrl: e.target.value })}
            />
          </label>
          <label>
            {t("provider.apiKey")}
            <input
              type="password"
              value={form.apiKey}
              onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
            />
          </label>
          <label>
            {t("provider.modelId")}
            <div className="flex gap-2">
              <input
                list="model-options"
                value={form.modelId}
                onChange={(e) => setForm({ ...form, modelId: e.target.value })}
              />
              <button
                type="button"
                disabled={fetchingModels}
                onClick={() => void handleFetchModels()}
              >
                {fetchingModels ? t("provider.fetchingModels") : t("provider.fetchModels")}
              </button>
            </div>
            <datalist id="model-options">
              {models.map((model) => (
                <option key={model} value={model} />
              ))}
            </datalist>
          </label>
          {modelFetchError && <div className="text-sm p-2 rounded-lg mt-2">{modelFetchError}</div>}
          {testResult && <div className="text-sm p-2 rounded-lg mt-2">{testResult}</div>}
          <div className="flex gap-2 mt-3">
            <button type="button" disabled={testing} onClick={() => void handleTest()}>
              {testing ? "…" : t("provider.testConnection")}
            </button>
            <button type="button" onClick={() => void handleSave()}>
              {t("provider.save")}
            </button>
            <button
              type="button"
              onClick={() => {
                setShowForm(false);
                setTestResult(null);
                setModels([]);
                setModelFetchError(null);
              }}
            >
              {t("provider.cancel")}
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          className="flex items-center justify-center gap-2 min-h-[38px] rounded-lg font-semibold border border-border bg-surface hover:bg-surface-hover transition"
          onClick={() => setShowForm(true)}
        >
          {t("provider.add")}
        </button>
      )}
    </div>
  );
}
