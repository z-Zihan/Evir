import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowLeft,
  ArrowRight,
  Bot,
  Globe,
  LoaderCircle,
  MonitorPlay,
  MousePointerClick,
  Plus,
  RotateCw,
  Square,
  Unplug,
  X,
} from "lucide-react";
import { Button, Tabs, TabsList, TabsTab, Tip } from "../../components/ui";
import {
  panelAnnotate,
  panelLayoutUpdate,
  panelTabActivate,
  panelTabClose,
  panelTabHistory,
  panelTabList,
  panelTabNew,
  panelTabNavigate,
  subscribePanelAnnotations,
  subscribePanelTabs,
  type PanelBrowserTab,
} from "../../features/workspace/browser-panel-service";
import { devServerFailureText, useDevServerUi } from "./use-dev-server-ui";
import {
  useWorkspacePanelStore,
  selectOverlayBlocked,
} from "../../features/workspace/workspace-panel-store";
import { useActiveWorkspaceRoot } from "../../features/workspace/workspace-bridge";
import { useProjectStore } from "../../features/projects/project-store";
import { useRunWorkspaceStore } from "../../features/workspace/workspace-run-store";
import { useChatStore } from "../../features/chat/chat-store";
import { logger } from "../../core/logging/logger";

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
 * Navigation reachability probe: a no-cors fetch resolves when ANY HTTP
 * response arrives (headers received) and rejects only on network-level
 * failure — DNS, connection refused, TLS. That is exactly the class the
 * webview cannot report itself, so probing first turns a blank page into an
 * actionable error card. Local hosts answer instantly (1.5s budget); remote
 * hosts get 5s so slow-but-alive sites are never falsely blocked.
 */
async function probeReachable(url: string): Promise<boolean> {
  const local =
    isLocal(url) || url.startsWith("https://localhost") || url.startsWith("https://127.0.0.1");
  const controller = new AbortController();
  const timer = globalThis.setTimeout(() => controller.abort(), local ? 1_500 : 5_000);
  try {
    await fetch(url, { mode: "no-cors", signal: controller.signal, cache: "no-store" });
    return true;
  } catch {
    return false;
  } finally {
    globalThis.clearTimeout(timer);
  }
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
  const [annotating, setAnnotating] = useState(false);
  const [pageError, setPageError] = useState<{ url: string } | null>(null);
  const dev = useDevServerUi();
  const contentRef = useRef<HTMLDivElement>(null);
  const layoutRef = useRef({ x: 0, y: 0, width: 0, height: 0 });
  const activeTab = tabs.find((tab) => tab.active) ?? tabs[0];
  const activeBrowserSessionId = activeTab?.id;
  const activeBrowserUrl = activeTab?.url;

  useEffect(() => {
    if (!activeBrowserSessionId) return;
    logger.info("browser", "browser.started", {
      browserSessionId: activeBrowserSessionId,
      ...(currentProjectId ? { projectId: currentProjectId } : {}),
      url: activeBrowserUrl,
    });
    return () => {
      logger.info("browser", "browser.closed", {
        browserSessionId: activeBrowserSessionId,
        ...(currentProjectId ? { projectId: currentProjectId } : {}),
      });
    };
  }, [activeBrowserSessionId, activeBrowserUrl, currentProjectId]);

  useEffect(() => {
    void panelTabList()
      .then(setTabs)
      .catch(() => setTabs([]));
    const unsubscribe = subscribePanelTabs((next) => setTabs(next)).catch(() => undefined);
    return () => {
      void unsubscribe?.then((fn) => fn?.());
    };
  }, [project?.id]);

  // A lost browser-panel-tabs event must not blank the toolbar: poll as a
  // re-sync backstop (the dev-server status lives in useDevServerUi).
  useEffect(() => {
    if (!project) return;
    let cancelled = false;
    const sync = () => {
      void panelTabList()
        .then((next) => {
          if (!cancelled) setTabs(next);
        })
        .catch(() => undefined);
    };
    const timer = window.setInterval(sync, 2000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [project]);

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

  const lastLoggedLayout = useRef<{
    visible: boolean;
    width: number;
    height: number;
  } | null>(null);
  const reportLayout = useCallback((requestedVisible: boolean) => {
    const layout = { ...layoutRef.current };
    // A native child webview must never be shown before the DOM has produced
    // a usable content rect. On mount the overlay effect runs before the first
    // animation-frame measurement; treating its requested visibility as the
    // actual visibility briefly exposed the offscreen 1x1 child webview and
    // left diagnostics with a misleading visible 0x0 layout.
    const visible = requestedVisible && layout.width > 0 && layout.height > 0;
    void panelLayoutUpdate({ ...layout, visible })
      .then(() => {
        // Rects churn every frame during a drag. Log visibility flips and the
        // first usable visible rect, but do not turn resize gestures into a
        // high-volume geometry trace.
        const previous = lastLoggedLayout.current;
        if (
          previous === null ||
          previous.visible !== visible ||
          (visible && (previous.width <= 0 || previous.height <= 0))
        ) {
          lastLoggedLayout.current = {
            visible,
            width: layout.width,
            height: layout.height,
          };
          logger.info("workspace", "browser.layout-visibility", {
            visible,
            ...layout,
          });
        }
      })
      .catch((error) => {
        logger.error("workspace", "browser.layout-update-failed", {
          visible,
          error: error instanceof Error ? error.message : String(error),
        });
      });
  }, []);

  // Geometry sync: report the content rect (CSS px relative to the main
  // window) so the native child webviews track resizes and tab switches.
  // ResizeObserver alone misses pure window moves/width changes where this
  // element keeps its size but shifts position — without the window listener
  // the native webview stays at stale screen coordinates and floats over the
  // thread column (observed over the composer). Window resizes hide the
  // native layer first, then re-report the measured rect one frame later:
  // between the two reports the old coordinates are wrong, and a visible
  // webview at a stale rect renders above the DOM.
  useEffect(() => {
    const element = contentRef.current;
    if (!element) return;
    let frame = 0;
    const measure = () => {
      if (frame !== 0) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const rect = element.getBoundingClientRect();
        layoutRef.current = { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
        reportLayout(!overlayBlocked);
      });
    };
    const onWindowResize = () => {
      reportLayout(false);
      measure();
    };
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    window.addEventListener("resize", onWindowResize);
    measure();
    return () => {
      if (frame !== 0) cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", onWindowResize);
      reportLayout(false);
    };
  }, [overlayBlocked, reportLayout]);

  // Native child webviews render above every DOM layer: any full-screen
  // overlay (settings, dialogs) must hide them first.
  useEffect(() => {
    reportLayout(!overlayBlocked);
  }, [overlayBlocked, reportLayout]);

  // Leaving the browser tab cancels an active picker; a picked element also
  // ends annotate mode (one annotation per activation).
  useEffect(() => {
    if (!annotating) return;
    const actionId = crypto.randomUUID();
    logger.info("browser", "browser.annotate-enabled", {
      actionId,
      browserSessionId: activeTab?.id,
      ...(currentProjectId ? { projectId: currentProjectId } : {}),
    });
    const unsubscribe = subscribePanelAnnotations((payload) => {
      const annotation =
        payload && typeof payload === "object" ? (payload as Record<string, unknown>) : undefined;
      logger.info("browser", "browser.annotation-received", {
        actionId,
        browserSessionId: activeTab?.id,
        ...(currentProjectId ? { projectId: currentProjectId } : {}),
        url: typeof annotation?.url === "string" ? annotation.url : null,
        tag: typeof annotation?.tag === "string" ? annotation.tag : null,
        selectorLength:
          typeof annotation?.selector === "string" ? annotation.selector.length : null,
      });
      setAnnotating(false);
    }).catch(() => undefined);
    return () => {
      void unsubscribe?.then((fn) => fn?.());
      void panelAnnotate(false).catch(() => undefined);
    };
  }, [activeTab?.id, annotating, currentProjectId]);

  const navigate = async (url: string, options?: { skipProbe?: boolean }): Promise<void> => {
    const target = normalizeInput(url);
    if (!target) return;
    const actionId = crypto.randomUUID();
    logger.info("browser", "browser.navigate", {
      actionId,
      browserSessionId: activeTab?.id,
      ...(currentProjectId ? { projectId: currentProjectId } : {}),
      target,
    });
    // Creating a native child webview moves focus away from the main frontend
    // and WebKit may throttle its timers. Persist the intent before crossing
    // that boundary so a navigation never disappears from diagnostics.
    await logger.flush();
    if (!options?.skipProbe && (target.startsWith("http://") || target.startsWith("https://"))) {
      const reachable = await probeReachable(target);
      if (!reachable) {
        setPageError({ url: target });
        logger.warn("browser", "browser.navigate-refused", {
          actionId,
          target,
        });
        return;
      }
    }
    setPageError(null);
    try {
      let browserSessionId: number;
      if (activeTab) {
        await panelTabNavigate(activeTab.id, target);
        browserSessionId = activeTab.id;
      } else {
        browserSessionId = (await panelTabNew(target)).id;
      }
      setTabs(await panelTabList());
      logger.info("browser", "browser.navigate-completed", {
        actionId,
        browserSessionId,
        ...(currentProjectId ? { projectId: currentProjectId } : {}),
        target,
      });
      await logger.flush();
    } catch (error) {
      logger.error("browser", "browser.navigate-failed", {
        actionId,
        browserSessionId: activeTab?.id,
        ...(currentProjectId ? { projectId: currentProjectId } : {}),
        target,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const screenshotOutputs = outputs.filter((output) => output.kind === "screenshot").slice(-3);
  const devServerStarting = dev.starting;
  const devServerFailure = devServerFailureText(dev, t("workspace.devServer.crashedHint"));
  const browserBusy = useRunWorkspaceStore((state) => state.browserActive);
  const conversationStreaming = useChatStore((state) => state.isStreaming);
  const agentUsingPage = browserBusy && conversationStreaming;

  return (
    <div className="workspace-browser-tab">
      <header className="workspace-browser-toolbar">
        <Tip content={t("browser.back")} side="bottom">
          <Button
            variant="ghost"
            size="icon-xs"
            className="disabled:opacity-35"
            disabled={!activeTab}
            onClick={() => activeTab && void panelTabHistory(activeTab.id, "back")}
            aria-label={t("browser.back")}
          >
            <ArrowLeft size={14} aria-hidden="true" />
          </Button>
        </Tip>
        <Tip content={t("browser.forward")} side="bottom">
          <Button
            variant="ghost"
            size="icon-xs"
            className="disabled:opacity-35"
            disabled={!activeTab}
            onClick={() => activeTab && void panelTabHistory(activeTab.id, "forward")}
            aria-label={t("browser.forward")}
          >
            <ArrowRight size={14} aria-hidden="true" />
          </Button>
        </Tip>
        <Tip content={t("browser.reload")} side="bottom">
          <Button
            variant="ghost"
            size="icon-xs"
            className="disabled:opacity-35"
            disabled={!activeTab}
            onClick={() => activeTab && void panelTabHistory(activeTab.id, "reload")}
            aria-label={t("browser.reload")}
          >
            <RotateCw size={14} aria-hidden="true" />
          </Button>
        </Tip>
        <form
          className="workspace-browser-address"
          onSubmit={(event) => {
            event.preventDefault();
            void navigate(address);
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
        <Tip content={t("workspace.newTab")} side="bottom">
          <Button
            variant="ghost"
            size="icon-xs"
            className="disabled:opacity-35"
            disabled={!tabs.length}
            onClick={() => {
              logger.info("ui", "ui.browser.open", {
                actionId: crypto.randomUUID(),
                browserSessionId: "new-tab",
              });
              void panelTabNew("about:blank").then(() => panelTabList().then(setTabs));
            }}
            aria-label={t("workspace.newTab")}
          >
            <Plus size={14} aria-hidden="true" />
          </Button>
        </Tip>
        <Tip content={t("workspace.annotate")} side="bottom">
          <Button
            variant="ghost"
            size="icon-xs"
            className={`workspace-icon-button disabled:opacity-35${annotating ? " active" : ""}`}
            disabled={!activeTab}
            aria-pressed={annotating}
            aria-label={t("workspace.annotate")}
            onClick={() => {
              const next = !annotating;
              setAnnotating(next);
              void panelAnnotate(next).catch(() => setAnnotating(false));
            }}
          >
            <MousePointerClick size={14} aria-hidden="true" />
          </Button>
        </Tip>
        {agentUsingPage && (
          <span className="workspace-browser-agent-chip" role="status">
            <Bot size={11} aria-hidden="true" />
            {t("browser.agentUsingPage")}
          </span>
        )}
      </header>
      {tabs.length > 0 && (
        <Tabs
          value={activeTab?.id ?? null}
          onValueChange={(value) => void panelTabActivate(value as number)}
        >
          <TabsList className="workspace-browser-tabbar" aria-label={t("workspace.browserTabs")}>
            {tabs.map((tab) => (
              <TabsTab
                key={tab.id}
                value={tab.id}
                className={`workspace-browser-tab-pill${tab.active ? " active" : ""}`}
              >
                <span className="tab-pill-main">
                  <span className="tab-pill-title">
                    {tab.title || tab.url.replace(/^https?:\/\//, "")}
                  </span>
                </span>
                <button
                  type="button"
                  className="tab-pill-close"
                  aria-label={t("workspace.closeTab")}
                  onClick={(event) => {
                    // Close must not bubble into the owning tab's activation.
                    event.stopPropagation();
                    void panelTabClose(tab.id).then(() => panelTabList().then(setTabs));
                  }}
                >
                  <X size={11} aria-hidden="true" />
                </button>
              </TabsTab>
            ))}
          </TabsList>
        </Tabs>
      )}
      <div
        className="workspace-browser-content"
        ref={contentRef}
        data-overlay-blocked={overlayBlocked ? "true" : undefined}
      >
        {pageError ? (
          <div className="workspace-empty browser workspace-browser-error" role="alert">
            <Unplug size={22} aria-hidden="true" />
            <p>{t("browser.pageFailedTitle")}</p>
            <p className="workspace-browser-error-detail">
              {isLocal(pageError.url)
                ? t("browser.pageFailedDetail", { url: pageError.url })
                : t("browser.networkFailedDetail", { url: pageError.url })}
            </p>
            <div className="workspace-browser-error-actions">
              <Button
                variant="secondary"
                size="lg"
                onClick={() => void navigate(pageError.url, { skipProbe: true })}
              >
                <RotateCw size={12} aria-hidden="true" />
                {t("browser.retry")}
              </Button>
            </div>
          </div>
        ) : tabs.length === 0 ? (
          <div className="workspace-empty browser">
            {devServerStarting ? (
              <LoaderCircle size={22} className="spin" aria-hidden="true" />
            ) : (
              <MonitorPlay size={22} aria-hidden="true" />
            )}
            <p aria-live="polite">
              {devServerStarting
                ? t("workspace.devServer.startingHint")
                : (devServerFailure ?? t("workspace.browserEmpty"))}
            </p>
          </div>
        ) : null}
      </div>
      {root && dev.server && (
        <footer className="workspace-devserver-card">
          {dev.active ? (
            <div className="devserver-state">
              <span className={`devserver-dot ${dev.server.status}`} aria-hidden="true" />
              <span className="devserver-copy">
                {t(`workspace.devServer.${dev.server.status}`)}
                {dev.server.url ? ` · ${dev.server.url}` : ""}
              </span>
              <Button variant="secondary" size="lg" onClick={() => void dev.stop()}>
                <Square size={12} aria-hidden="true" />
                {t("workspace.devServer.stop")}
              </Button>
            </div>
          ) : dev.server.status === "crashed" ? (
            <div className="devserver-state">
              <span className="devserver-dot crashed" aria-hidden="true" />
              <span className="devserver-copy">{t("workspace.devServer.crashed")}</span>
              <Button
                variant="secondary"
                size="lg"
                disabled={dev.starting}
                onClick={() => void dev.start()}
              >
                {t("workspace.devServer.retry")}
              </Button>
            </div>
          ) : null}
          {devServerFailure && <span className="devserver-error">{devServerFailure}</span>}
          {screenshotOutputs.length > 0 && (
            <div className="devserver-screenshots" aria-label={t("workspace.recentScreenshots")}>
              {screenshotOutputs.map((output) => (
                <Tip key={output.id} content={output.path}>
                  <button
                    type="button"
                    className="devserver-screenshot-chip"
                    onClick={() =>
                      useWorkspacePanelStore
                        .getState()
                        .openResource({ kind: "screenshot", path: output.path })
                    }
                  >
                    {t("workspace.screenshotChip")}
                  </button>
                </Tip>
              ))}
            </div>
          )}
        </footer>
      )}
    </div>
  );
}
