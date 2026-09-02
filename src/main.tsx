import React, { lazy, Suspense } from "react";
import ReactDOM from "react-dom/client";
import { App } from "./app/App";
import { startRunToastBridge } from "./features/chat/run-toast-bridge";

// Toast host is lazy: sonner only loads if a background-run toast ever fires.
const Toaster = lazy(() => import("./components/ui/sonner").then((m) => ({ default: m.Toaster })));
import { BrowserWorkbench } from "./app/BrowserWorkbench";
import { ErrorBoundary } from "./app/ErrorBoundary";
import "./i18n/config";
import "./styles/app.css";
import "./styles/supplemental.css";
import "./styles/shell.css";
import "./styles/preview.css";

// The Browser Workbench window boots the same bundle under #browser and
// renders only the browser chrome (its capability never sees chat/storage).
const isBrowserWindow = window.location.hash === "#browser";

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
