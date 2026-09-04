import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Globe, PlayCircle, Power, RefreshCw } from "lucide-react";
import { Button, cn } from "../components/ui";
import { InlineError } from "../components/feedback";
import {
  SettingsDescription,
  SettingsGroup,
  SettingsPage,
  SettingsPageIntro,
  SettingsRow,
} from "../components/settings";
import {
  type AgentBrowserProviderId,
  egoTaskSpaceName,
  readAgentBrowserProvider,
  writeAgentBrowserProvider,
} from "../features/browser/browser-provider";

interface RuntimeStatus {
  available: boolean;
  engine: string;
  path: string;
  running: boolean;
  version: string | null;
}

interface EgoStatus {
  available: boolean;
  cliPath: string;
  appConnected: boolean | { ok: boolean; error: string } | null;
}

/**
 * Settings panel for the browser runtimes: runtime detection status, agent
 * browser lifecycle, the agent browser provider (Evir Browser / Ego Lite
 * experimental), and the Browser Workbench entry point. CfT auto-download is
 * intentionally not bundled — the runtime is reused from the system, and ego
 * lite is never installed silently.
 */
export function BrowserSettings() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<RuntimeStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [startFailed, setStartFailed] = useState(false);
  const [provider, setProvider] = useState<AgentBrowserProviderId>("evir");
  const [egoStatus, setEgoStatus] = useState<EgoStatus | null>(null);
  const [egoProbing, setEgoProbing] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const { tauriInvoke } = await import("../runtime/tauri-ipc");
      setStatus(await tauriInvoke<RuntimeStatus>("browser_agent_status"));
    } catch {
      setStatus(null);
    }
  }, []);

  useEffect(() => {
    setProvider(readAgentBrowserProvider());
  }, []);

  useEffect(() => {
    if (provider !== "ego-lite" || egoStatus) return;
    let mounted = true;
    void (async () => {
      try {
        const { tauriInvoke } = await import("../runtime/tauri-ipc");
        const result = await tauriInvoke<EgoStatus>("ego_browser_status");
        if (mounted) setEgoStatus(result);
      } catch {
        if (mounted) setEgoStatus(null);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [provider, egoStatus]);

  const selectProvider = (next: AgentBrowserProviderId) => {
    if (next === provider) return;
    try {
      writeAgentBrowserProvider(next);
      setProvider(next);
    } catch {
      setStartFailed(true);
    }
  };

  const probeEgo = async () => {
    setEgoProbing(true);
    try {
      const { tauriInvoke } = await import("../runtime/tauri-ipc");
      setEgoStatus(await tauriInvoke<EgoStatus>("ego_browser_status", { probe: true }));
    } catch {
      setStartFailed(true);
    }
    setEgoProbing(false);
  };

  const stopEgoSession = async () => {
    setEgoProbing(true);
    try {
      const { tauriInvoke } = await import("../runtime/tauri-ipc");
      await tauriInvoke("ego_browser_stop", { space: egoTaskSpaceName() });
    } catch {
      setStartFailed(true);
    }
    setEgoProbing(false);
  };

  const startAgent = async () => {
    setBusy(true);
    setStartFailed(false);
    try {
      const { tauriInvoke } = await import("../runtime/tauri-ipc");
      await tauriInvoke("browser_agent_start");
    } catch {
      setStartFailed(true);
    }
    await refresh();
    setBusy(false);
  };

  const stopAgent = async () => {
    setBusy(true);
    try {
      const { tauriInvoke } = await import("../runtime/tauri-ipc");
      await tauriInvoke("browser_agent_stop");
    } catch {
      setStartFailed(true);
    }
    await refresh();
    setBusy(false);
  };

  const openWorkbench = async () => {
    try {
      const { tauriInvoke } = await import("../runtime/tauri-ipc");
      await tauriInvoke("browser_workbench_open");
    } catch {
      setStartFailed(true);
    }
  };

  return (
    <SettingsPage aria-label={t("browser.runtime.title")}>
      <SettingsPageIntro
        eyebrow={t("browser.runtime.title")}
        description={t("browser.runtime.description")}
      />
      <SettingsGroup>
        <SettingsRow
          label={t("browser.runtime.available")}
          control={
            <span
              className={cn(
                "text-[12px] font-medium",
                status?.available ? "text-success" : "text-danger",
              )}
            >
              {status?.available ? status.engine : t("browser.runtime.notAvailable")}
            </span>
          }
        />
        {status?.available && status.path && (
          <SettingsRow
            label={t("browser.runtime.path")}
            control={
              <span
                className="max-w-72 truncate font-mono text-[11.5px] text-muted"
                title={status.path}
              >
                {status.path.length > 72 ? `${status.path.slice(0, 72)}…` : status.path}
              </span>
            }
          />
        )}
        <SettingsRow
          label={t("browser.runtime.title")}
          control={
            <span className="text-[12px] text-foreground">
              {status?.running ? t("browser.runtime.running") : t("browser.runtime.notRunning")}
            </span>
          }
        />
        {!status?.available && (
          <SettingsDescription className="px-4 pb-3.5">
            {t("browser.runtime.installHint")}
          </SettingsDescription>
        )}
        {startFailed && (
          <InlineError className="mx-4 mb-3.5" message={t("browser.runtime.startFailed")} />
        )}
        <div className="flex items-center gap-2 px-4 py-3.5">
          <Button variant="secondary" size="sm" onClick={() => void openWorkbench()}>
            <Globe size={14} />
            {t("browser.openWorkbench")}
          </Button>
          {status?.running ? (
            <Button variant="secondary" size="sm" disabled={busy} onClick={() => void stopAgent()}>
              <Power size={14} />
              {t("browser.runtime.stop")}
            </Button>
          ) : (
            <Button
              variant="secondary"
              size="sm"
              disabled={busy || !status?.available}
              onClick={() => void startAgent()}
            >
              <PlayCircle size={14} />
              {t("browser.runtime.start")}
            </Button>
          )}
        </div>
      </SettingsGroup>

      <SettingsGroup>
        <div className="px-4 pt-3.5">
          <h3 className="text-[12.5px] font-semibold text-foreground">
            {t("browser.provider.title")}
          </h3>
          <p className="mt-1 text-[11.5px] leading-relaxed text-muted">
            {t("browser.provider.description")}
          </p>
        </div>
        <div role="radiogroup" aria-label={t("browser.provider.title")} className="flex flex-col">
          {(
            [
              {
                id: "evir" as const,
                label: t("browser.provider.evir"),
                hint: t("browser.provider.evirHint"),
              },
              {
                id: "ego-lite" as const,
                label: t("browser.provider.ego"),
                hint: t("browser.provider.egoHint"),
              },
            ] satisfies { id: AgentBrowserProviderId; label: string; hint: string }[]
          ).map((option) => (
            <button
              key={option.id}
              type="button"
              role="radio"
              aria-checked={provider === option.id}
              className={cn(
                "flex flex-col gap-1 border-l-2 px-4 py-3 text-left transition-colors",
                provider === option.id
                  ? "border-accent bg-surface-subtle"
                  : "border-transparent hover:bg-surface-subtle/60",
              )}
              onClick={() => selectProvider(option.id)}
            >
              <span className="flex items-center gap-2 text-[12.5px] font-medium text-foreground">
                {option.label}
                {option.id === "ego-lite" && provider === option.id && (
                  <span className="rounded-full border border-border px-1.5 py-px text-[10px] font-medium text-muted">
                    {t("browser.provider.experimental")}
                  </span>
                )}
              </span>
              <span className="text-[11.5px] leading-relaxed text-muted">{option.hint}</span>
            </button>
          ))}
        </div>
        {provider === "ego-lite" && (
          <>
            <SettingsRow
              label={t("browser.provider.cliStatus")}
              control={
                <span
                  className={cn(
                    "text-[12px] font-medium",
                    egoStatus?.available ? "text-success" : "text-danger",
                  )}
                >
                  {egoStatus?.available
                    ? t("browser.provider.available")
                    : t("browser.provider.notAvailable")}
                </span>
              }
            />
            {egoStatus?.appConnected !== null && egoStatus?.appConnected !== undefined && (
              <SettingsRow
                label={t("browser.provider.connection")}
                control={
                  <span
                    className={cn(
                      "max-w-64 text-right text-[12px] font-medium",
                      egoStatus.appConnected === true ? "text-success" : "text-danger",
                    )}
                    title={
                      typeof egoStatus.appConnected === "object"
                        ? egoStatus.appConnected.error
                        : undefined
                    }
                  >
                    {egoStatus.appConnected === true
                      ? t("browser.provider.connected")
                      : t("browser.provider.notConnected")}
                  </span>
                }
              />
            )}
            <SettingsDescription className="px-4">
              {t("browser.provider.setupHint")}
            </SettingsDescription>
            <div className="flex items-center gap-2 px-4 py-3.5">
              <Button
                variant="secondary"
                size="sm"
                disabled={egoProbing || !egoStatus?.available}
                onClick={() => void probeEgo()}
              >
                <RefreshCw size={14} />
                {egoProbing ? t("browser.provider.checking") : t("browser.provider.check")}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={egoProbing}
                onClick={() => void stopEgoSession()}
              >
                <Power size={14} />
                {t("browser.provider.stopSession")}
              </Button>
            </div>
          </>
        )}
      </SettingsGroup>
    </SettingsPage>
  );
}
