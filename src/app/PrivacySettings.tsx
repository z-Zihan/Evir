import { useState } from "react";
import { useTranslation } from "react-i18next";
import { db } from "../core/storage/db";

type ActionState = "idle" | "clearing" | "success" | "error";

export function PrivacySettings() {
  const { t } = useTranslation();
  const [resultKey, setResultKey] = useState<ActionState>("idle");
  const [errorMessage, setErrorMessage] = useState<string>("");

  const clearWithConfirm = async (key: string, action: () => Promise<void>) => {
    if (!window.confirm(t("privacy.confirmClear"))) return;
    setResultKey("clearing");
    setErrorMessage("");
    try {
      await action();
      setResultKey("success");
      setTimeout(() => setResultKey("idle"), 3000);
    } catch (e: unknown) {
      setErrorMessage(e instanceof Error ? e.message : String(e));
      setResultKey("error");
      setTimeout(() => setResultKey("idle"), 5000);
    }
  };

  const clearConversations = () =>
    clearWithConfirm("conversations", async () => {
      await db.conversations.clear();
      await db.messages.clear();
      await db.attachments.clear();
    });

  const clearProviders = () =>
    clearWithConfirm("providers", async () => {
      await db.providers.clear();
    });

  const clearUsage = () =>
    clearWithConfirm("usage", async () => {
      await db.usage_records.clear();
    });

  const clearMcp = () =>
    clearWithConfirm("mcp", async () => {
      await db.mcpServers.clear();
    });

  const clearAll = () =>
    clearWithConfirm("all", async () => {
      await db.providers.clear();
      await db.conversations.clear();
      await db.messages.clear();
      await db.attachments.clear();
      await db.usage_records.clear();
      await db.mcpServers.clear();
      await db.settings.clear();
    });

  return (
    <section className="privacy-settings">
      <h3>{t("privacy.title")}</h3>

      <p className="privacy-warning">{t("privacy.confirmClear")}</p>

      <div className="privacy-actions">
        <button
          type="button"
          className="privacy-btn danger"
          onClick={() => void clearConversations()}
        >
          {t("privacy.clearConversations")}
        </button>

        <button type="button" className="privacy-btn danger" onClick={() => void clearProviders()}>
          {t("privacy.clearProviders")}
        </button>

        <button type="button" className="privacy-btn danger" onClick={() => void clearUsage()}>
          {t("privacy.clearUsage")}
        </button>

        <button type="button" className="privacy-btn danger" onClick={() => void clearMcp()}>
          {t("privacy.clearMcp")}
        </button>

        <button type="button" className="privacy-btn danger-danger" onClick={() => void clearAll()}>
          {t("privacy.clearAll")}
        </button>
      </div>

      {resultKey === "success" && (
        <div className="privacy-result success">{t("privacy.cleared")}</div>
      )}
      {resultKey === "error" && (
        <div className="privacy-result error">
          {t("privacy.clearFailed")}
          {errorMessage ? `: ${errorMessage}` : ""}
        </div>
      )}
    </section>
  );
}
