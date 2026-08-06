import { useState } from "react";
import { useTranslation } from "react-i18next";
import { db } from "../core/storage/db";
import { useChatStore } from "../features/chat/chat-store";

type ActionState = "idle" | "clearing" | "success" | "error";

export function PrivacySettings() {
  const { t } = useTranslation();
  const { privateSession, togglePrivateSession } = useChatStore();
  const [resultKey, setResultKey] = useState<ActionState>("idle");
  const [errorMessage, setErrorMessage] = useState<string>("");

  const clearWithConfirm = async (action: () => Promise<void>) => {
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
    clearWithConfirm(async () => {
      await db.transaction("rw", db.conversations, db.messages, db.attachments, async () => {
        await db.conversations.clear();
        await db.messages.clear();
        await db.attachments.clear();
      });
    });

  const clearProviders = () =>
    clearWithConfirm(async () => {
      await db.providers.clear();
    });

  const clearUsage = () =>
    clearWithConfirm(async () => {
      await db.usage_records.clear();
    });

  const clearMcp = () =>
    clearWithConfirm(async () => {
      await db.mcpServers.clear();
    });

  const clearAll = () =>
    clearWithConfirm(async () => {
      await db.transaction(
        "rw",
        [
          db.providers,
          db.conversations,
          db.messages,
          db.attachments,
          db.usage_records,
          db.mcpServers,
          db.settings,
        ],
        async () => {
          await db.providers.clear();
          await db.conversations.clear();
          await db.messages.clear();
          await db.attachments.clear();
          await db.usage_records.clear();
          await db.mcpServers.clear();
          await db.settings.clear();
        },
      );
    });

  return (
    <section className="privacy-settings">
      <h3>{t("privacy.title")}</h3>
      <div className="flex items-center justify-between gap-2 px-4 py-2 border border-border rounded-lg">
        <span className="text-sm">{t("chat.privateSession")}</span>
        <button
          type="button"
          className={`grid place-items-center w-8 h-8 rounded-lg text-muted hover:bg-surface-hover hover:text-foreground transition${privateSession ? " active" : ""}`}
          onClick={togglePrivateSession}
          aria-label={t("chat.privateSession")}
          aria-pressed={privateSession}
        >
          {privateSession ? "🔒" : "🔓"}
        </button>
      </div>
      <p className="privacy-warning">{t("privacy.confirmClear")}</p>
      <div className="privacy-actions">
        <button
          type="button"
          className="flex items-center gap-2 px-4 py-2 border border-border rounded-lg cursor-pointer text-sm hover:bg-surface-hover transition danger"
          disabled={resultKey === "clearing"}
          onClick={() => void clearConversations()}
        >
          {t("privacy.clearConversations")}
        </button>
        <button
          type="button"
          className="flex items-center gap-2 px-4 py-2 border border-border rounded-lg cursor-pointer text-sm hover:bg-surface-hover transition danger"
          disabled={resultKey === "clearing"}
          onClick={() => void clearProviders()}
        >
          {t("privacy.clearProviders")}
        </button>
        <button
          type="button"
          className="flex items-center gap-2 px-4 py-2 border border-border rounded-lg cursor-pointer text-sm hover:bg-surface-hover transition danger"
          disabled={resultKey === "clearing"}
          onClick={() => void clearUsage()}
        >
          {t("privacy.clearUsage")}
        </button>
        <button
          type="button"
          className="flex items-center gap-2 px-4 py-2 border border-border rounded-lg cursor-pointer text-sm hover:bg-surface-hover transition danger"
          disabled={resultKey === "clearing"}
          onClick={() => void clearMcp()}
        >
          {t("privacy.clearMcp")}
        </button>
        <button
          type="button"
          className="flex items-center gap-2 px-4 py-2 border border-border rounded-lg cursor-pointer text-sm hover:bg-surface-hover transition danger severe"
          disabled={resultKey === "clearing"}
          onClick={() => void clearAll()}
        >
          {t("privacy.clearAll")}
        </button>
      </div>
      {resultKey === "clearing" && (
        <div className="text-sm p-2 rounded-lg mt-1" role="alert">
          {t("privacy.confirmClear")}
        </div>
      )}
      {resultKey === "success" && (
        <div className="text-sm p-2 rounded-lg mt-1 success" role="alert">
          {t("privacy.cleared")}
        </div>
      )}
      {resultKey === "error" && (
        <div className="text-sm p-2 rounded-lg mt-1 error" role="alert">
          {t("privacy.clearFailed")}
          {errorMessage ? `: ${errorMessage}` : ""}
        </div>
      )}
    </section>
  );
}
