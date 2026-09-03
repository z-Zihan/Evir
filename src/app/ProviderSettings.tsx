import { useMemo, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Pencil, Plus, Server, Trash2 } from "lucide-react";
import { Button, Tip } from "../components/ui";
import { SettingsPage, SettingsPageIntro, SettingsSection } from "../components/settings";
import { PROVIDER_PRESETS } from "../core/providers/provider-presets";
import type { ProviderPreset } from "../core/providers/types";
import { useProviderStore, type ProviderConfigInput } from "../features/provider/provider-store";
import { useConfirmationDialog } from "./useConfirmationDialog";
import {
  EMPTY_FORM,
  providerInitial,
  supportedProtocol,
  validationErrors,
  type DialogStep,
  type FieldErrors,
  type ProviderField,
} from "./provider/form-model";
import { ProviderCatalogDialog } from "./provider/ProviderCatalogDialog";
import { ProviderFormDialog } from "./provider/ProviderFormDialog";

/**
 * Providers settings page: configured-connection list plus the two-step
 * setup dialogs (catalog → form), which live in ./provider/.
 */
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
  const [form, setForm] = useState<ProviderConfigInput>({ ...EMPTY_FORM });
  const [baselineForm, setBaselineForm] = useState<ProviderConfigInput>({ ...EMPTY_FORM });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [models, setModels] = useState<string[]>([]);
  const [fetchingModels, setFetchingModels] = useState(false);

  const resetDialog = () => {
    setStep("closed");
    setEditingId(null);
    setSelectedPresetId(null);
    setForm({ ...EMPTY_FORM });
    setBaselineForm({ ...EMPTY_FORM });
    setErrors({});
    setTestResult(null);
    setModels([]);
  };

  const applyForm = (next: ProviderConfigInput) => {
    setForm(next);
    setBaselineForm({ ...next });
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
    applyForm({
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
      applyForm({ ...EMPTY_FORM });
    } else {
      const protocolId = supportedProtocol(preset);
      if (!protocolId) return;
      setSelectedPresetId(preset.id);
      applyForm({
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
    setTestResult(
      discovered.length
        ? t("provider.fetchModelsSuccess", { count: discovered.length })
        : t("provider.fetchModelsFailed"),
    );
    setFetchingModels(false);
  };

  const formDirty = useMemo(
    () => JSON.stringify(form) !== JSON.stringify(baselineForm),
    [form, baselineForm],
  );

  return (
    <SettingsPage className="provider-settings">
      <SettingsPageIntro
        eyebrow={t("settingsDescriptions.modelConnections")}
        description={t("provider.addDescription")}
        action={
          <span className="shrink-0 rounded-md border border-border px-2 py-1 text-[9.5px] whitespace-nowrap text-muted">
            {t("settingsDescriptions.providerCount", { count: providers.length })}
          </span>
        }
      />

      {providers.length ? (
        <section className="flex flex-col gap-3" aria-label={t("provider.configured")}>
          <SettingsSection
            title={t("provider.configured")}
            description={t("provider.configuredDescription")}
            action={
              <Button variant="secondary" size="lg" onClick={openAdd}>
                <Plus size={14} /> {t("provider.add")}
              </Button>
            }
          >
            <div className="flex flex-col px-1">
              {providers.map((provider) => (
                <article
                  className="provider-connection-row grid min-h-14 grid-cols-[30px_minmax(0,1fr)_auto_auto] items-center gap-2.5 border-b border-border py-2 last:border-b-0"
                  key={provider.id}
                >
                  <span
                    className="grid size-7.5 place-items-center rounded-lg bg-surface-hover text-[10.5px] font-bold text-foreground"
                    aria-hidden="true"
                  >
                    {providerInitial(provider.name)}
                  </span>
                  <div className="min-w-0">
                    <strong className="block truncate text-[12.5px] font-semibold text-foreground">
                      {provider.name}
                    </strong>
                    <span className="block truncate text-[10.5px] text-muted">
                      {provider.modelId} · {provider.protocolId}
                    </span>
                  </div>
                  {provider.isDefault && (
                    <span className="rounded-md border border-primary/40 bg-primary/[0.08] px-2 py-0.5 text-[9.5px] font-semibold text-primary">
                      {t("provider.default")}
                    </span>
                  )}
                  <div className="flex items-center gap-1">
                    {!provider.isDefault && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => void setDefaultProvider(provider.id)}
                      >
                        {t("provider.setDefault")}
                      </Button>
                    )}
                    <Button variant="ghost" size="sm" onClick={() => openEdit(provider.id)}>
                      <Pencil size={13} aria-hidden="true" /> <span>{t("provider.edit")}</span>
                    </Button>
                    <Tip content={t("provider.delete")}>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={t("provider.delete")}
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
                      </Button>
                    </Tip>
                  </div>
                </article>
              ))}
            </div>
          </SettingsSection>
        </section>
      ) : (
        <div className="flex min-h-62.5 flex-col items-center justify-center rounded-xl border border-dashed border-border-strong bg-surface-subtle p-8.5 text-center">
          <div
            className="mb-3.5 grid size-10.5 place-items-center rounded-xl border border-border bg-surface text-primary"
            aria-hidden="true"
          >
            <Server size={20} />
          </div>
          <strong className="text-[14px] font-semibold text-foreground">
            {t("provider.noProviders")}
          </strong>
          <p className="mt-2 mb-4.5 max-w-[420px] text-[12px] leading-relaxed text-muted">
            {t("provider.addDescription")}
          </p>
          <Button variant="primary" size="default" onClick={openAdd}>
            <Plus size={15} aria-hidden="true" /> {t("provider.add")}
          </Button>
        </div>
      )}

      {step === "presets" && (
        <ProviderCatalogDialog
          presets={presets}
          selectedPresetId={selectedPresetId}
          onChoose={choosePreset}
          onClose={resetDialog}
        />
      )}

      {step === "form" && (
        <ProviderFormDialog
          editing={Boolean(editingId)}
          form={form}
          errors={errors}
          models={models}
          fetchingModels={fetchingModels}
          testing={testing}
          testResult={testResult}
          formDirty={formDirty}
          onBack={() => setStep("presets")}
          onFieldChange={updateField}
          onFetchModels={() => void handleFetchModels()}
          onTest={() => void handleTest()}
          onSave={(event) => void handleSave(event)}
          onClose={resetDialog}
        />
      )}
      {confirmationDialog}
    </SettingsPage>
  );
}
