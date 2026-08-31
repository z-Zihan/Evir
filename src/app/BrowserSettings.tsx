import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Globe, PlayCircle, Power } from "lucide-react";

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
    <section className="settings-panel" aria-label={t("browser.runtime.title")}>
      <h3 className="settings-panel-title">{t("browser.runtime.title")}</h3>
      <p className="settings-panel-description">{t("browser.runtime.description")}</p>
      <div className="browser-runtime-card">
        <div className="browser-runtime-row">
          <span className="browser-runtime-label">{t("browser.runtime.available")}</span>
          <span className={`browser-runtime-value${status?.available ? " ok" : " bad"}`}>
            {status?.available ? status.engine : t("browser.runtime.notAvailable")}
          </span>
        </div>
        {status?.available && status.path && (
          <div className="browser-runtime-row">
            <span className="browser-runtime-label">{t("browser.runtime.path")}</span>
            <span className="browser-runtime-value mono" title={status.path}>
              {status.path.length > 72 ? `${status.path.slice(0, 72)}…` : status.path}
            </span>
          </div>
        )}
        <div className="browser-runtime-row">
          <span className="browser-runtime-label">{t("browser.runtime.title")}</span>
          <span className="browser-runtime-value">
            {status?.running ? t("browser.runtime.running") : t("browser.runtime.notRunning")}
          </span>
        </div>
        {!status?.available && (
          <p className="browser-runtime-hint">{t("browser.runtime.installHint")}</p>
        )}
        {startFailed && (
          <p className="browser-runtime-hint bad">{t("browser.runtime.startFailed")}</p>
        )}
        <div className="browser-runtime-actions">
          <button type="button" className="settings-button" onClick={() => void openWorkbench()}>
            <Globe size={14} />
            {t("browser.openWorkbench")}
          </button>
          {status?.running ? (
            <button
              type="button"
              className="settings-button"
              disabled={busy}
              onClick={() => void stopAgent()}
            >
              <Power size={14} />
              {t("browser.runtime.stop")}
            </button>
          ) : (
            <button
              type="button"
              className="settings-button"
              disabled={busy || !status?.available}
              onClick={() => void startAgent()}
            >
              <PlayCircle size={14} />
              {t("browser.runtime.start")}
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
