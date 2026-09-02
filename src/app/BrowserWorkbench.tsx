import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowLeft,
  ArrowRight,
  ExternalLink,
  Globe,
  Lock,
  Plus,
  RotateCw,
  Trash2,
  X,
} from "lucide-react";
import { Button } from "../components/ui";
import {
  activateTab as activateTabCommand,
  clearSiteData as clearSiteDataCommand,
  closeTab as closeTabCommand,
  listWorkbenchTabs,
  navigateTab as navigateTabCommand,
  newTab as newTabCommand,
  openExternal,
  subscribeTabs,
  tabHistory as tabHistoryCommand,
  updateContentLayout,
} from "../features/browser/workbench-service";
import type { WorkbenchTab } from "../features/browser/workbench-service";

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/**
 * Chrome UI of the Browser Workbench window. The remote content lives in
 * separate child webviews positioned by the Rust layer (zero Tauri
 * permissions); this component only renders toolbar/tabs and reports the
 * content-area geometry.
 */
export function BrowserWorkbench() {
  const { t } = useTranslation();
  const [tabs, setTabs] = useState<WorkbenchTab[]>([]);
  const [address, setAddress] = useState("");
  const contentRef = useRef<HTMLDivElement | null>(null);
  const activeTab = tabs.find((tab) => tab.active) ?? tabs.at(-1);

  useEffect(() => {
    let disposed = false;
    let stop: (() => void) | undefined;
    void subscribeTabs((tabs) => {
      if (!disposed) setTabs(tabs);
    }).then((unlisten) => {
      if (disposed) unlisten();
      else stop = unlisten;
    });
    void listWorkbenchTabs().then((initial) => {
      if (!disposed) setTabs(initial);
    });
    return () => {
      disposed = true;
      stop?.();
    };
  }, []);

  useEffect(() => {
    setAddress(activeTab?.url ?? "");
  }, [activeTab?.url, activeTab?.id]);

  // Report the content-area rect so child webviews track window resizes.
  useEffect(() => {
    const element = contentRef.current;
    if (!element) return;
    let frame = 0;
    const report = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const rect = element.getBoundingClientRect();
        void updateContentLayout({
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
        }).catch(() => undefined);
      });
    };
    const observer = new ResizeObserver(report);
    observer.observe(element);
    report();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, []);

  const run = useCallback(async (action: () => Promise<void>) => {
    try {
      await action();
    } catch {
      // Command failures leave tab state untouched; the next event syncs.
    }
  }, []);

  const submitAddress = () => {
    const value = address.trim();
    if (!value) return;
    if (activeTab) {
      void run(() => navigateTabCommand(activeTab.id, value));
    } else {
      void run(() => newTabCommand(value));
    }
  };

  const isSecure = activeTab?.url.startsWith("https://") ?? false;
  const isLocal =
    (activeTab?.url.startsWith("http://localhost") ||
      activeTab?.url.startsWith("http://127.0.0.1")) ??
    false;

  return (
    <div className="browser-workbench">
      <header className="browser-toolbar" role="toolbar" aria-label={t("browser.toolbar")}>
        <Button
          variant="ghost"
          className="h-7 w-[30px] rounded-md disabled:opacity-40"
          aria-label={t("browser.back")}
          disabled={!activeTab}
          onClick={() => {
            if (activeTab) void run(() => tabHistoryCommand(activeTab.id, "back"));
          }}
        >
          <ArrowLeft size={15} />
        </Button>
        <Button
          variant="ghost"
          className="h-7 w-[30px] rounded-md disabled:opacity-40"
          aria-label={t("browser.forward")}
          disabled={!activeTab}
          onClick={() => {
            if (activeTab) void run(() => tabHistoryCommand(activeTab.id, "forward"));
          }}
        >
          <ArrowRight size={15} />
        </Button>
        <Button
          variant="ghost"
          className="h-7 w-[30px] rounded-md disabled:opacity-40"
          aria-label={t("browser.reload")}
          disabled={!activeTab}
          onClick={() => {
            if (activeTab) void run(() => tabHistoryCommand(activeTab.id, "reload"));
          }}
        >
          <RotateCw size={14} />
        </Button>
        <form
          className="browser-address-form"
          onSubmit={(event) => {
            event.preventDefault();
            submitAddress();
          }}
        >
          <span
            className="browser-origin-indicator"
            aria-label={isSecure ? t("browser.secure") : t("browser.insecure")}
          >
            {isSecure ? <Lock size={12} /> : isLocal ? <Globe size={12} /> : null}
          </span>
          <input
            className="browser-address-input"
            value={address}
            onChange={(event) => setAddress(event.target.value)}
            placeholder={t("browser.addressPlaceholder")}
            aria-label={t("browser.addressLabel")}
            spellCheck={false}
          />
          {activeTab && (
            <Button
              variant="ghost"
              className="h-7 w-[30px] rounded-md disabled:opacity-40"
              aria-label={t("browser.openExternal")}
              onClick={() => void openExternal(activeTab.url).catch(() => undefined)}
            >
              <ExternalLink size={13} />
            </Button>
          )}
        </form>
        <Button
          variant="ghost"
          className="h-7 w-[30px] rounded-md disabled:opacity-40"
          aria-label={t("browser.newTab")}
          onClick={() => void run(() => newTabCommand("https://duckduckgo.com"))}
        >
          <Plus size={15} />
        </Button>
      </header>
      <div className="browser-tabbar" role="tablist" aria-label={t("browser.tabs")}>
        {tabs.map((tab) => (
          <div
            key={tab.id}
            className={`browser-tab${tab.active ? " active" : ""}`}
            role="tab"
            aria-selected={tab.active}
            onClick={() => void run(() => activateTabCommand(tab.id))}
          >
            <span className="browser-tab-title">{tab.title || hostOf(tab.url)}</span>
            <Button
              variant="ghost"
              className="h-auto rounded-sm p-px"
              aria-label={t("browser.closeTab")}
              onClick={(event) => {
                event.stopPropagation();
                void run(() => closeTabCommand(tab.id));
              }}
            >
              <X size={11} />
            </Button>
          </div>
        ))}
        {tabs.length === 0 && <span className="browser-empty-hint">{t("browser.emptyHint")}</span>}
      </div>
      {/* Remote content renders in Rust-managed child webviews over this area. */}
      <div className="browser-content-area" ref={contentRef} aria-hidden="true">
        {tabs.length === 0 && (
          <div className="browser-start">
            <Globe size={28} aria-hidden="true" />
            <p>{t("browser.startHint")}</p>
            <Button
              variant="primary"
              size="lg"
              onClick={() => void run(() => newTabCommand("https://duckduckgo.com"))}
            >
              {t("browser.openStartPage")}
            </Button>
          </div>
        )}
      </div>
      <footer className="browser-statusbar">
        <span className="browser-status-origin">{activeTab ? hostOf(activeTab.url) : ""}</span>
        <button
          type="button"
          className="browser-clear-data"
          onClick={() => {
            void clearSiteDataCommand().catch(() => undefined);
          }}
          aria-label={t("browser.clearData")}
        >
          <Trash2 size={12} />
          {t("browser.clearData")}
        </button>
      </footer>
    </div>
  );
}
