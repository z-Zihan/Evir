import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./app/App";
import { ErrorBoundary } from "./app/ErrorBoundary";
import "./i18n/config";
import "./styles/app.css";
import "./styles/main.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
