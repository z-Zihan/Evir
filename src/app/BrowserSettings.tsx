import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Globe, PlayCircle, Power } from "lucide-react";
import { Button, cn } from "../components/ui";
import { InlineError } from "../components/feedback";
import {
  SettingsDescription,
  SettingsGroup,
  SettingsPage,
  SettingsPageIntro,
  SettingsRow,
} from "../components/settings";

interface RuntimeStatus {
  available: boolean;
  engine: string;
  path: string;
  running: boolean;
  version: string | null;
}

/**
 * Settings panel for the browser runtimes: runtime detection status, agent
 * browser lifecycle, and the Browser Workbench entry point. CfT auto-download
 * is intentionally not bundled — the runtime is reused from the system.
 */
export function BrowserSettings() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<RuntimeStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [startFailed, setStartFailed] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const { tauriInvoke } = await import("../runtime/tauri-ipc");
      setStatus(await tauriInvoke<RuntimeStatus>("browser_agent_status"));
    } catch {
      setStatus(null);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

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
    </SettingsPage>
  );
}
