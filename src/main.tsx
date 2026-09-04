import React, { lazy, Suspense } from "react";
import ReactDOM from "react-dom/client";

// Toast host is lazy: sonner only loads if a background-run toast ever fires.
const Toaster = lazy(() => import("./components/ui/sonner").then((m) => ({ default: m.Toaster })));
import { BrowserWorkbench } from "./app/BrowserWorkbench";
import { ErrorBoundary } from "./app/ErrorBoundary";
import "./i18n/config";
import "./styles/app.css";
// Feature-scoped CSS (§8): each file serves one feature domain; shared tokens
// and reset live in app.css, preview renderers in styles/preview.css.
import "./styles/features/shell/shell-layout.css";
import "./styles/features/sidebar/sidebar.css";
import "./styles/features/chat/conversation.css";
import "./styles/features/chat/markdown.css";
import "./styles/features/orchestration/workbench.css";
import "./styles/features/settings/settings-shell.css";
import "./styles/features/settings/identity.css";
import "./styles/features/settings/personalization.css";
import "./styles/features/settings/usage.css";
import "./styles/features/settings/provider.css";
import "./styles/features/settings/skills.css";
import "./styles/features/workspace/preview.css";
import "./styles/features/workspace/browser.css";
import "./styles/preview.css";

// The Browser Workbench window boots the same bundle under #browser and
// renders only the browser chrome (its capability never sees chat/storage).
const isBrowserWindow = window.location.hash === "#browser";

// Profile bootstrap (§52) must complete before the app bundle's stores load:
// the active profile decides the Dexie namespace and profile-scoped
// localStorage keys, and those are read at module-init time. A registry
// failure falls back to the default profile rather than blocking the app.
async function bootstrap(): Promise<void> {
  try {
    const { useProfileStore } = await import("./features/profiles/profile-service");
    await useProfileStore.getState().init();
  } catch {
    /* default profile */
  }
  const [{ App }, { startRunToastBridge }] = await Promise.all([
    import("./app/App"),
    import("./features/chat/run-toast-bridge"),
  ]);

  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <ErrorBoundary>
        {isBrowserWindow ? <BrowserWorkbench /> : <App />}
        {!isBrowserWindow && (
          <Suspense fallback={null}>
            <Toaster />
          </Suspense>
        )}
      </ErrorBoundary>
    </React.StrictMode>,
  );

  // Background-run toasts (sidebar badges remain the primary status surface).
  startRunToastBridge();
}

void bootstrap();
