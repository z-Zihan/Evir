import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./app/App";
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
    <ErrorBoundary>{isBrowserWindow ? <BrowserWorkbench /> : <App />}</ErrorBoundary>
  </React.StrictMode>,
);
