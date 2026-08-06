import { useState } from "react";
import { useTranslation } from "react-i18next";
import { LockKeyhole, UnlockKeyhole } from "lucide-react";
import { db } from "../core/storage/db";
import { useChatStore } from "../features/chat/chat-store";
import { useConfirmationDialog } from "./useConfirmationDialog";

type ActionState = "idle" | "clearing" | "success" | "error";

export function PrivacySettings() {
  const { t } = useTranslation();
  const { privateSession, togglePrivateSession } = useChatStore();
  const [resultKey, setResultKey] = useState<ActionState>("idle");
  const [errorMessage, setErrorMessage] = useState<string>("");
  const { requestConfirmation, confirmationDialog } = useConfirmationDialog();

  const clearData = async (action: () => Promise<void>) => {
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
    clearData(async () => {
      await db.transaction("rw", db.conversations, db.messages, db.attachments, async () => {
        await db.conversations.clear();
        await db.messages.clear();
        await db.attachments.clear();
      });
    });

  const clearProviders = () =>
    clearData(async () => {
      await db.providers.clear();
    });

  const clearUsage = () =>
    clearData(async () => {
      await db.usage_records.clear();
    });

  const clearMcp = () =>
    clearData(async () => {
      await db.mcpServers.clear();
    });

  const clearAll = () =>
    clearData(async () => {
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
      <div className="settings-page-intro compact">
        <div>
          <span className="settings-page-eyebrow">{t("settingsDescriptions.localData")}</span>
          <p>{t("settingsDescriptions.privacy")}</p>
        </div>
      </div>
      <div className="privacy-session-card">
        <span className="text-sm">{t("chat.privateSession")}</span>
        <button
          type="button"
          className={`grid place-items-center w-8 h-8 rounded-lg text-muted hover:bg-surface-hover hover:text-foreground transition${privateSession ? " active" : ""}`}
          onClick={togglePrivateSession}
          aria-label={t("chat.privateSession")}
          aria-pressed={privateSession}
        >
          {privateSession ? <LockKeyhole size={15} /> : <UnlockKeyhole size={15} />}
        </button>
      </div>
      <div className="danger-zone-heading">
        <strong>{t("privacy.dangerZone")}</strong>
        <span>{t("privacy.confirmClear")}</span>
      </div>
      <div className="privacy-actions">
        <button
          type="button"
          className="flex items-center gap-2 px-4 py-2 border border-border rounded-lg cursor-pointer text-sm hover:bg-surface-hover transition danger"
          disabled={resultKey === "clearing"}
          onClick={() =>
            requestConfirmation(
              {
                title: t("confirmation.clearTitle"),
                description: t("confirmation.clearDescription", {
                  item: t("privacy.conversationsData"),
                }),
                confirmLabel: t("privacy.clearConversations"),
              },
              clearConversations,
            )
          }
        >
          {t("privacy.clearConversations")}
        </button>
        <button
          type="button"
          className="flex items-center gap-2 px-4 py-2 border border-border rounded-lg cursor-pointer text-sm hover:bg-surface-hover transition danger"
          disabled={resultKey === "clearing"}
          onClick={() =>
            requestConfirmation(
              {
                title: t("confirmation.clearTitle"),
                description: t("confirmation.clearDescription", {
                  item: t("privacy.providersData"),
                }),
                confirmLabel: t("privacy.clearProviders"),
              },
              clearProviders,
            )
          }
        >
          {t("privacy.clearProviders")}
        </button>
        <button
          type="button"
          className="flex items-center gap-2 px-4 py-2 border border-border rounded-lg cursor-pointer text-sm hover:bg-surface-hover transition danger"
          disabled={resultKey === "clearing"}
          onClick={() =>
            requestConfirmation(
              {
                title: t("confirmation.clearTitle"),
                description: t("confirmation.clearDescription", {
                  item: t("privacy.usageData"),
                }),
                confirmLabel: t("privacy.clearUsage"),
              },
              clearUsage,
            )
          }
        >
          {t("privacy.clearUsage")}
        </button>
        <button
          type="button"
          className="flex items-center gap-2 px-4 py-2 border border-border rounded-lg cursor-pointer text-sm hover:bg-surface-hover transition danger"
          disabled={resultKey === "clearing"}
          onClick={() =>
            requestConfirmation(
              {
                title: t("confirmation.clearTitle"),
                description: t("confirmation.clearDescription", {
                  item: t("privacy.mcpData"),
                }),
                confirmLabel: t("privacy.clearMcp"),
              },
              clearMcp,
            )
          }
        >
          {t("privacy.clearMcp")}
        </button>
        <button
          type="button"
          className="flex items-center gap-2 px-4 py-2 border border-border rounded-lg cursor-pointer text-sm hover:bg-surface-hover transition danger severe"
          disabled={resultKey === "clearing"}
          onClick={() =>
            requestConfirmation(
              {
                title: t("confirmation.clearAllTitle"),
                description: t("confirmation.clearAllDescription"),
                confirmLabel: t("privacy.clearAll"),
              },
              clearAll,
            )
          }
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
      {confirmationDialog}
    </section>
  );
}
