import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { FolderOpen, KeyRound, LoaderCircle, ServerCog } from "lucide-react";
import { Button, Input } from "../../components/ui";
import { PROVIDER_PRESETS } from "../../core/providers/provider-presets";
import { SUPPORTED_PROTOCOLS } from "../provider/form-model";
import type { ProviderConfigInput } from "../../features/provider/provider-store";
import { useProviderStore } from "../../features/provider/provider-store";
import { getRuntime } from "../../runtime/use-runtime";
import { cn } from "../../components/ui/utils";

/**
 * First-run setup (§B5): a clean vault lands on a three-step card, not the
 * 36-preset settings catalog.
 *   1. Connect a model — quick presets + API key (or Ollama, no key).
 *   2. Automatic detection — models are fetched, a bounded tool-call probe
 *      decides "Agent ready" vs "Chat only" (honest: unconfirmed ⇒ chat only).
 *   3. Open a folder — into a project, ready for the first task.
 * "More providers" keeps the full catalog one click away (§B5.2).
 */

const QUICK_PRESET_IDS = ["zhipu", "openai", "deepseek", "anthropic", "ollama"] as const;

type SetupPhase = "connect" | "detecting" | "ready";

export function FirstRunSetupCard({ onOpenSettings }: { onOpenSettings: () => void }) {
  const { t } = useTranslation();
  const addProvider = useProviderStore((state) => state.addProvider);
  const updateProvider = useProviderStore((state) => state.updateProvider);
  const fetchModels = useProviderStore((state) => state.fetchModels);
  const probeToolCalling = useProviderStore((state) => state.probeToolCalling);

  const quickPresets = useMemo(
    () =>
      QUICK_PRESET_IDS.map((id) => PROVIDER_PRESETS.find((preset) => preset.id === id))
        .filter((preset): preset is NonNullable<typeof preset> => preset !== undefined)
        .map((preset) => ({
          id: preset.id,
          name: preset.name,
          // The catalog picks the preset's first form-supported protocol the
          // same way (e.g. Ollama connects via openai-compatible-chat).
          protocolId:
            (preset.protocols.find((protocol) =>
              SUPPORTED_PROTOCOLS.has(protocol as ProviderConfigInput["protocolId"]),
            ) as ProviderConfigInput["protocolId"]) ?? preset.recommendedProtocol,
          baseUrl: preset.endpoints[0]?.baseUrl ?? "",
          requiresKey: !preset.authModes.some((mode) => mode.startsWith("none")),
        })),
    [],
  );
  const [presetId, setPresetId] = useState<string>(quickPresets[0]?.id ?? "");
  const preset = quickPresets.find((entry) => entry.id === presetId) ?? quickPresets[0];
  const [apiKey, setApiKey] = useState("");
  const [phase, setPhase] = useState<SetupPhase>("connect");
  const [error, setError] = useState<string | null>(null);
  const [detection, setDetection] = useState<{
    modelId: string;
    toolCalling: boolean;
  } | null>(null);

  const connect = async () => {
    if (!preset) return;
    if (preset.requiresKey && apiKey.trim().length === 0) {
      setError(t("firstRun.keyRequired"));
      return;
    }
    setError(null);
    setPhase("detecting");
    try {
      // A placeholder model id satisfies the schema; step 2 replaces it with
      // a real id from the endpoint's model list.
      const provider = await addProvider({
        name: preset.name,
        protocolId: preset.protocolId,
        baseUrl: preset.baseUrl,
        apiKey: apiKey.trim() || "local",
        modelId: "auto",
        toolCalling: false,
      });
      const models = await fetchModels({
        name: preset.name,
        protocolId: preset.protocolId,
        baseUrl: preset.baseUrl,
        apiKey: apiKey.trim() || "local",
        modelId: "auto",
        toolCalling: false,
      });
      const modelId = models[0] ?? "auto";
      const toolCalling =
        modelId === "auto"
          ? false
          : await probeToolCalling(
              {
                name: preset.name,
                protocolId: preset.protocolId,
                baseUrl: preset.baseUrl,
                apiKey: apiKey.trim() || "local",
                modelId,
                toolCalling: false,
              },
              modelId,
            );
      await updateProvider(provider.id, { modelId, toolCalling });
      setDetection({ modelId, toolCalling });
      setPhase("ready");
    } catch (cause) {
      setPhase("connect");
      setError(cause instanceof Error ? cause.message : t("firstRun.connectFailed"));
    }
  };

  const openFolder = async () => {
    const runtime = getRuntime();
    const directory = (await runtime.selectWorkspaceDirectory?.()) ?? null;
    if (!directory) return;
    const { useProjectStore } = await import("../../features/projects/project-store");
    const result = await useProjectStore.getState().addProject(directory);
    if (result.error) setError(t(`firstRun.${result.error}`));
  };

  return (
    <section
      className="first-run-card mx-auto w-full max-w-[460px] rounded-2xl border border-border bg-surface-subtle p-5"
      aria-label={t("firstRun.title")}
    >
      <h2 className="m-0 flex items-center gap-2 text-[14px] font-semibold text-foreground">
        <ServerCog size={16} aria-hidden="true" className="text-primary" />
        {t("firstRun.title")}
      </h2>
      <p className="mt-1 text-[12px] text-muted">{t("firstRun.subtitle")}</p>

      {phase === "connect" && (
        <div className="mt-4 flex flex-col gap-3">
          <div
            className="flex flex-wrap gap-1.5"
            role="group"
            aria-label={t("firstRun.pickProvider")}
          >
            {quickPresets.map((entry) => (
              <button
                key={entry.id}
                type="button"
                className={cn(
                  "cursor-pointer rounded-full border px-2.5 py-1 text-[11.5px] transition-colors select-none",
                  entry.id === preset?.id
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border bg-surface text-muted hover:border-border-strong hover:text-foreground",
                )}
                aria-pressed={entry.id === preset?.id}
                onClick={() => setPresetId(entry.id)}
              >
                {entry.name}
              </button>
            ))}
          </div>
          {preset?.requiresKey ? (
            <label className="flex flex-col gap-1 text-[11.5px] text-muted">
              {t("firstRun.apiKey")}
              <Input
                type="password"
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                placeholder={t("firstRun.apiKeyPlaceholder")}
                className="h-8"
              />
            </label>
          ) : (
            <p className="m-0 text-[11.5px] text-muted">{t("firstRun.ollamaHint")}</p>
          )}
          {error && (
            <p className="m-0 text-[11.5px] text-danger" role="alert">
              {error}
            </p>
          )}
          <div className="flex items-center gap-2">
            <Button variant="primary" size="sm" onClick={() => void connect()}>
              <KeyRound size={13} />
              {t("firstRun.connect")}
            </Button>
            <Button variant="ghost" size="sm" onClick={onOpenSettings}>
              {t("firstRun.moreProviders")}
            </Button>
          </div>
        </div>
      )}

      {phase === "detecting" && (
        <p className="mt-4 flex items-center gap-2 text-[12px] text-muted">
          <LoaderCircle size={14} className="animate-spin" aria-hidden="true" />
          {t("firstRun.detecting")}
        </p>
      )}

      {phase === "ready" && detection && (
        <div className="mt-4 flex flex-col gap-2.5">
          <p className="m-0 text-[12px] text-foreground">
            {detection.toolCalling ? t("firstRun.agentReady") : t("firstRun.chatOnly")}{" "}
            <span className="font-mono text-[11px] text-muted">{detection.modelId}</span>
          </p>
          {getRuntime().target === "desktop" && (
            <Button variant="primary" size="sm" onClick={() => void openFolder()}>
              <FolderOpen size={13} />
              {t("firstRun.openFolder")}
            </Button>
          )}
        </div>
      )}
    </section>
  );
}
