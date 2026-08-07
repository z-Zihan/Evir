import { useState } from "react";
import { useTranslation } from "react-i18next";
import { LockKeyhole, UnlockKeyhole } from "lucide-react";
import type { ProviderRecord } from "../core/storage/db";
import { useChatStore } from "../features/chat/chat-store";
import { useConfirmationDialog } from "./useConfirmationDialog";
import { getStructuredStorage } from "../runtime/structured-storage";
import { getRuntime, isNativeDesktopRuntime } from "../runtime/use-runtime";
import { useProviderStore } from "../features/provider/provider-store";
import { useUsageStore } from "../features/usage/usage-store";
import { useMcpStore } from "../features/mcp/mcp-store";

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
      await getStructuredStorage().apply([
        { type: "clear", entity: "conversations" },
        { type: "clear", entity: "messages" },
        { type: "clear", entity: "attachments" },
      ]);
      useChatStore.setState({ conversations: [], currentConversationId: null, messages: [] });
    });

  const clearProviders = () =>
    clearData(async () => {
      const providers = await getStructuredStorage().readAll<ProviderRecord>("providers");
      if (isNativeDesktopRuntime()) {
        const nativeStorage = getRuntime().storage;
        if (nativeStorage) {
          await Promise.all(
            providers.map(({ id }) => nativeStorage.keychainDelete(`provider:${id}:api-key`)),
          );
        }
      }
      await getStructuredStorage().clear("providers");
      useProviderStore.setState({ providers: [] });
    });

  const clearUsage = () =>
    clearData(async () => {
      await getStructuredStorage().clear("usage_records");
      useUsageStore.setState({ records: [] });
    });

  const clearMcp = () =>
    clearData(async () => {
      await getStructuredStorage().clear("mcp_servers");
      useMcpStore.setState({ servers: [] });
    });

  const clearAll = () =>
    clearData(async () => {
      const providers = await getStructuredStorage().readAll<ProviderRecord>("providers");
      if (isNativeDesktopRuntime()) {
        const nativeStorage = getRuntime().storage;
        if (nativeStorage) {
          await Promise.all(
            providers.map(({ id }) => nativeStorage.keychainDelete(`provider:${id}:api-key`)),
          );
        }
      }
      await getStructuredStorage().apply([
        { type: "clear", entity: "providers" },
        { type: "clear", entity: "conversations" },
        { type: "clear", entity: "messages" },
        { type: "clear", entity: "attachments" },
        { type: "clear", entity: "usage_records" },
        { type: "clear", entity: "mcp_servers" },
        { type: "clear", entity: "settings" },
      ]);
      useProviderStore.setState({ providers: [] });
      useChatStore.setState({ conversations: [], currentConversationId: null, messages: [] });
      useUsageStore.setState({ records: [] });
      useMcpStore.setState({ servers: [] });
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
          title={t("chat.privateSession")}
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
