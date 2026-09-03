import { useState } from "react";
import { useTranslation } from "react-i18next";
import { LockKeyhole, UnlockKeyhole } from "lucide-react";
import { Button, Tip } from "../components/ui";
import { InlineError } from "../components/feedback";
import {
  SettingsDangerZone,
  SettingsGroup,
  SettingsPage,
  SettingsPageIntro,
  SettingsRow,
} from "../components/settings";
import type { ProviderRecord, SettingRecord } from "../core/storage/db";
import { useChatStore } from "../features/chat/chat-store";
import { useConfirmationDialog } from "./useConfirmationDialog";
import { getStructuredStorage } from "../runtime/structured-storage";
import { getRuntime, isNativeDesktopRuntime } from "../runtime/use-runtime";
import { useProviderStore } from "../features/provider/provider-store";
import { useUsageStore } from "../features/usage/usage-store";
import { useMcpStore } from "../features/mcp/mcp-store";
import { useMemoryStore, type MemoryRecord } from "../features/memory/memory-store";

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
      // Wiping conversations kills the backing data of any active run — stop
      // it first instead of letting it persist rows for a cleared store.
      const chat = useChatStore.getState();
      // Stop every active run — concurrent tasks included — before wiping.
      for (const conversationId of Object.keys(chat.streamSlots ?? {})) {
        chat.stopGeneration(conversationId);
      }
      const storage = getStructuredStorage();
      const conversationMemories = (await storage.readAll<MemoryRecord>("memories")).filter(
        ({ type }) => type === "conversation",
      );
      const conversationCheckpoints = (await storage.readAll<SettingRecord>("settings")).filter(
        ({ name }) => name.startsWith("checkpoint:"),
      );
      await storage.apply([
        { type: "clear", entity: "conversations" },
        { type: "clear", entity: "messages" },
        { type: "clear", entity: "attachments" },
        ...conversationMemories.map(({ id }) => ({
          type: "delete" as const,
          entity: "memories" as const,
          id,
        })),
        ...conversationCheckpoints.map(({ name }) => ({
          type: "delete" as const,
          entity: "settings" as const,
          id: name,
        })),
      ]);
      useChatStore.setState({ conversations: [], currentConversationId: null, messages: [] });
      useMemoryStore.setState(({ memories }) => ({
        memories: memories.filter(({ type }) => type !== "conversation"),
      }));
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
      const chat = useChatStore.getState();
      // Stop every active run — concurrent tasks included — before wiping.
      for (const conversationId of Object.keys(chat.streamSlots ?? {})) {
        chat.stopGeneration(conversationId);
      }
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
        { type: "clear", entity: "memories" },
        { type: "clear", entity: "settings" },
      ]);
      useProviderStore.setState({ providers: [] });
      useChatStore.setState({ conversations: [], currentConversationId: null, messages: [] });
      useUsageStore.setState({ records: [] });
      useMcpStore.setState({ servers: [] });
      useMemoryStore.setState({ memories: [], enabled: true, error: null });
    });

  return (
    <SettingsPage>
      <SettingsPageIntro
        eyebrow={t("settingsDescriptions.localData")}
        description={t("settingsDescriptions.privacy")}
      />
      <SettingsGroup>
        <SettingsRow
          label={t("chat.privateSession")}
          control={
            <div className="flex items-center">
              <Tip content={t("chat.privateSession")}>
                <button
                  type="button"
                  className={`grid place-items-center w-8 h-8 rounded-lg text-muted hover:bg-surface-hover hover:text-foreground transition${privateSession ? " active" : ""}`}
                  onClick={togglePrivateSession}
                  aria-label={t("chat.privateSession")}
                  aria-pressed={privateSession}
                >
                  {privateSession ? <LockKeyhole size={15} /> : <UnlockKeyhole size={15} />}
                </button>
              </Tip>
            </div>
          }
        />
      </SettingsGroup>
      <SettingsDangerZone title={t("privacy.dangerZone")} description={t("privacy.confirmClear")}>
        <div className="grid gap-[7px] sm:grid-cols-2">
          <Button
            variant="outline"
            size="lg"
            className="justify-start"
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
          </Button>
          <Button
            variant="outline"
            size="lg"
            className="justify-start"
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
          </Button>
          <Button
            variant="outline"
            size="lg"
            className="justify-start"
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
          </Button>
          <Button
            variant="outline"
            size="lg"
            className="justify-start"
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
          </Button>
          <Button
            variant="outline"
            size="lg"
            className="justify-start sm:col-span-2"
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
          </Button>
        </div>
      </SettingsDangerZone>
      {resultKey === "clearing" && (
        <p className="m-0 rounded-lg p-2 text-sm" role="alert">
          {t("privacy.confirmClear")}
        </p>
      )}
      {resultKey === "success" && (
        <p className="m-0 rounded-lg p-2 text-sm text-success" role="alert">
          {t("privacy.cleared")}
        </p>
      )}
      {resultKey === "error" && (
        <InlineError
          message={
            <>
              {t("privacy.clearFailed")}
              {errorMessage ? `: ${errorMessage}` : ""}
            </>
          }
        />
      )}
      {confirmationDialog}
    </SettingsPage>
  );
}
