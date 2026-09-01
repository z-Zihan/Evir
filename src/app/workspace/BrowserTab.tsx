import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowLeft,
  ArrowRight,
  Globe,
  LoaderCircle,
  MonitorPlay,
  Plus,
  RotateCw,
  Square,
  X,
} from "lucide-react";
import {
  panelLayoutUpdate,
  panelTabActivate,
  panelTabClose,
  panelTabHistory,
  panelTabList,
  panelTabNew,
  panelTabNavigate,
  subscribePanelTabs,
  type PanelBrowserTab,
} from "../../features/workspace/browser-panel-service";
import {
  detectDevScript,
  devServerStart,
  devServerStop,
  subscribeDevServerStatus,
  type DevScriptPlan,
  type DevServerState,
} from "../../features/workspace/dev-server-service";
import {
  useWorkspacePanelStore,
  selectOverlayBlocked,
} from "../../features/workspace/workspace-panel-store";
import { useActiveWorkspaceRoot } from "../../features/workspace/workspace-bridge";
import { useProjectStore } from "../../features/projects/project-store";
import { useRunWorkspaceStore } from "../../features/workspace/workspace-run-store";
import { useConfirmationDialog } from "../useConfirmationDialog";

function normalizeInput(input: string): string {
  const trimmed = input.trim();
  if (
    trimmed.startsWith("http://") ||
    trimmed.startsWith("https://") ||
    trimmed.startsWith("about:")
  ) {
    return trimmed;
  }
  const local =
    trimmed.startsWith("localhost") ||
    trimmed.startsWith("127.0.0.1") ||
    trimmed.startsWith("[::1]");
  return local ? `http://${trimmed}` : `https://${trimmed}`;
}

function isLocal(url: string): boolean {
  return (
    url.startsWith("http://localhost") ||
    url.startsWith("http://127.0.0.1") ||
    url.startsWith("http://[::1]")
  );
}

/**
 * Workspace browser surface: minimal chrome (§32) over Rust-managed child
 * webviews. The thread column stays alive on the left — this is what makes
 * the product an agent workspace instead of a separate browser page.
 */
export function BrowserTab() {
  const { t } = useTranslation();
  const root = useActiveWorkspaceRoot();
  const projects = useProjectStore((state) => state.projects);
  const currentProjectId = useProjectStore((state) => state.currentProjectId);
  const project = projects.find(({ id }) => id === currentProjectId);
  const overlayBlocked = useWorkspacePanelStore(selectOverlayBlocked);
  const outputs = useRunWorkspaceStore((state) => state.outputs);
  const [tabs, setTabs] = useState<PanelBrowserTab[]>([]);
  const [address, setAddress] = useState("");
  const [starting, setStarting] = useState(false);
  const [devPlan, setDevPlan] = useState<DevScriptPlan | null>(null);
  const [devServer, setDevServer] = useState<DevServerState | null>(null);
  const [devError, setDevError] = useState<string | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const layoutRef = useRef({ x: 0, y: 0, width: 0, height: 0 });
  const {
    requestConfirmation: requestDevServerConfirmation,
    confirmationDialog: devServerConfirmation,
  } = useConfirmationDialog();
  const activeTab = tabs.find((tab) => tab.active) ?? tabs[0];

  useEffect(() => {
    void panelTabList()
      .then(setTabs)
      .catch(() => setTabs([]));
    const unsubscribe = subscribePanelTabs((next) => setTabs(next)).catch(() => undefined);
    const unsubscribeStatus = subscribeDevServerStatus((state) => {
      if (state.projectId === (project?.id ?? "")) setDevServer(state);
    }).catch(() => undefined);
    return () => {
      void unsubscribe?.then((fn) => fn?.());
      void unsubscribeStatus?.then((fn) => fn?.());
    };
  }, [project?.id]);

  const activeTabUrl = activeTab?.url;
  useEffect(() => {
    if (activeTabUrl) setAddress(activeTabUrl);
  }, [activeTabUrl]);

  // Expose the current page to composer context chips (§33–34).
  const setBrowserContextUrl = useWorkspacePanelStore((state) => state.setBrowserContextUrl);
  useEffect(() => {
    setBrowserContextUrl(activeTab?.url ?? null);
    return () => setBrowserContextUrl(null);
  }, [activeTab?.url, setBrowserContextUrl]);

  useEffect(() => {
    if (!root) return;
    let cancelled = false;
    void detectDevScript(root).then((plan) => {
      if (!cancelled) setDevPlan(plan);
    });
    return () => {
      cancelled = true;
    };
  }, [root]);

  const reportLayout = useCallback((visible: boolean) => {
    void panelLayoutUpdate({ ...layoutRef.current, visible }).catch(() => undefined);
  }, []);

  // Geometry sync: report the content rect (CSS px relative to the main
  // window) so the native child webviews track resizes and tab switches.
  useEffect(() => {
    const element = contentRef.current;
    if (!element) return;
    const measure = () => {
      const rect = element.getBoundingClientRect();
      layoutRef.current = { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
      reportLayout(rect.width > 0 && rect.height > 0);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    measure();
    return () => observer.disconnect();
  }, [reportLayout]);

  useEffect(() => {
    reportLayout(true);
    return () => reportLayout(false);
  }, [reportLayout]);

  // Native child webviews render above every DOM layer: any full-screen
  // overlay (settings, dialogs) must hide them first.
  useEffect(() => {
    reportLayout(!overlayBlocked);
  }, [overlayBlocked, reportLayout]);

  const navigate = (url: string) => {
    const target = normalizeInput(url);
    if (!target) return;
    if (activeTab) {
      void panelTabNavigate(activeTab.id, target);
    } else {
      void panelTabNew(target)
        .then(() => panelTabList().then(setTabs))
        .catch(() => undefined);
    }
  };

  const startDevServer = () => {
    if (!devPlan || !root || !project) return;
    // §44: detect → show command → Evir permission → start. The ask profile
    // gates every start behind an explicit confirmation.
    if (project.permissionProfile === "ask") {
      requestDevServerConfirmation(
        {
          title: t("workspace.devServer.confirmTitle"),
          description: t("workspace.devServer.confirmDescription", {
            command: `${devPlan.program} ${devPlan.args.join(" ")}`,
            cwd: root,
          }),
          confirmLabel: t("workspace.devServer.run"),
          tone: "warning",
        },
        () => void invokeDevServerStart(),
      );
      return;
    }
    void invokeDevServerStart();
  };

  const invokeDevServerStart = async () => {
    if (!devPlan || !root || !project) return;
    setStarting(true);
    setDevError(null);
    try {
      const state = await devServerStart({
        projectId: project.id,
        cwd: root,
        program: devPlan.program,
        args: devPlan.args,
        workspaceRoot: root,
      });
      setDevServer(state);
    } catch (error) {
      setDevError(String(error));
    } finally {
      setStarting(false);
    }
  };

  // When the dev server turns ready, open its URL (user-initiated flow).
  useEffect(() => {
    if (devServer?.status === "ready" && devServer.url) {
      navigate(devServer.url);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [devServer?.status, devServer?.url]);

  const screenshotOutputs = outputs.filter((output) => output.kind === "screenshot").slice(-3);

  return (
    <div className="workspace-browser-tab">
      <header className="workspace-browser-toolbar">
        <button
          type="button"
          className="workspace-icon-button"
          disabled={!activeTab}
          onClick={() => activeTab && void panelTabHistory(activeTab.id, "back")}
          aria-label={t("browser.back")}
          data-tip={t("browser.back")}
        >
          <ArrowLeft size={14} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="workspace-icon-button"
          disabled={!activeTab}
          onClick={() => activeTab && void panelTabHistory(activeTab.id, "forward")}
          aria-label={t("browser.forward")}
          data-tip={t("browser.forward")}
        >
          <ArrowRight size={14} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="workspace-icon-button"
          disabled={!activeTab}
          onClick={() => activeTab && void panelTabHistory(activeTab.id, "reload")}
          aria-label={t("browser.reload")}
          data-tip={t("browser.reload")}
        >
          <RotateCw size={14} aria-hidden="true" />
        </button>
        <form
          className="workspace-browser-address"
          onSubmit={(event) => {
            event.preventDefault();
            navigate(address);
          }}
        >
          <span
            className={`workspace-browser-origin ${activeTab && isLocal(activeTab.url) ? "local" : "secure"}`}
            aria-hidden="true"
          >
            <Globe size={11} />
          </span>
          <input
            value={address}
            onChange={(event) => setAddress(event.target.value)}
            placeholder={t("workspace.browserAddress")}
            aria-label={t("workspace.browserAddress")}
            spellCheck={false}
          />
        </form>
        <button
          type="button"
          className="workspace-icon-button"
          disabled={!tabs.length}
          onClick={() => void panelTabNew("about:blank").then(() => panelTabList().then(setTabs))}
          aria-label={t("workspace.newTab")}
          data-tip={t("workspace.newTab")}
        >
          <Plus size={14} aria-hidden="true" />
        </button>
      </header>
      {tabs.length > 0 && (
        <div
          className="workspace-browser-tabbar"
          role="tablist"
          aria-label={t("workspace.browserTabs")}
        >
          {tabs.map((tab) => (
            <div
              key={tab.id}
              className={`workspace-browser-tab-pill${tab.active ? " active" : ""}`}
              role="tab"
              aria-selected={tab.active}
            >
              <button
                type="button"
                className="tab-pill-main"
                onClick={() => void panelTabActivate(tab.id)}
              >
                <span className="tab-pill-title">
                  {tab.title || tab.url.replace(/^https?:\/\//, "")}
                </span>
              </button>
              <button
                type="button"
                className="tab-pill-close"
                aria-label={t("workspace.closeTab")}
                onClick={() => {
                  void panelTabClose(tab.id).then(() => panelTabList().then(setTabs));
                }}
              >
                <X size={11} aria-hidden="true" />
              </button>
            </div>
          ))}
        </div>
      )}
      <div
        className="workspace-browser-content"
        ref={contentRef}
        data-overlay-blocked={overlayBlocked ? "true" : undefined}
      >
        {tabs.length === 0 && (
          <div className="workspace-empty browser">
            <MonitorPlay size={22} aria-hidden="true" />
            <p>{t("workspace.browserEmpty")}</p>
          </div>
        )}
      </div>
      {root && (
        <footer className="workspace-devserver-card">
          {devServer && devServer.status !== "stopped" ? (
            <div className="devserver-state">
              <span className={`devserver-dot ${devServer.status}`} aria-hidden="true" />
              <span className="devserver-copy">
                {t(`workspace.devServer.${devServer.status}`)}
                {devServer.url ? ` · ${devServer.url}` : ""}
              </span>
              <button
                type="button"
                className="secondary-button"
                onClick={() => {
                  if (!project) return;
                  void devServerStop(project.id);
                }}
              >
                <Square size={12} aria-hidden="true" />
                {t("workspace.devServer.stop")}
              </button>
            </div>
          ) : devPlan ? (
            <div className="devserver-state">
              {starting ? (
                <LoaderCircle size={13} className="spin" aria-hidden="true" />
              ) : (
                <MonitorPlay size={13} aria-hidden="true" />
              )}
              <span className="devserver-copy">
                {t("workspace.devServer.detect", {
                  script: `${devPlan.program} ${devPlan.args.join(" ")}`,
                })}
              </span>
              <button
                type="button"
                className="secondary-button"
                disabled={starting}
                onClick={startDevServer}
              >
                {t("workspace.devServer.run")}
              </button>
            </div>
          ) : (
            <span className="devserver-copy muted">{t("workspace.devServer.none")}</span>
          )}
          {devError && <span className="devserver-error">{devError}</span>}
          {screenshotOutputs.length > 0 && (
            <div className="devserver-screenshots" aria-label={t("workspace.recentScreenshots")}>
              {screenshotOutputs.map((output) => (
                <button
                  key={output.id}
                  type="button"
                  className="devserver-screenshot-chip"
                  data-tip={output.path}
                  onClick={() =>
                    useWorkspacePanelStore
                      .getState()
                      .openResource({ kind: "screenshot", path: output.path })
                  }
                >
                  {t("workspace.screenshotChip")}
                </button>
              ))}
            </div>
          )}
        </footer>
      )}
      {devServerConfirmation}
    </div>
  );
}
