import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { getModelSwitchCoordinator } from "../../features/chat/model-switch-service";
import type {
  ModelSwitchAssessment,
  ModelSwitchRequest,
} from "../../core/providers/model-switching";
import { useChatStore } from "../../features/chat/chat-store";
import { useProviderStore } from "../../features/provider/provider-store";
import type { ProviderRecord } from "../../core/storage/db";
import { useConfirmationDialog } from "../useConfirmationDialog";

interface ModelSwitchContext {
  conversationId: string | null;
  privateSession: boolean;
  fromProviderId: string;
  fromModelId: string;
  mode: string;
  hasActiveExecution: boolean;
}

/**
 * In-chat model switching: assessment → optional confirmation (data
 * destination / mode downgrade) → coordinated switch. Blocking outcomes are
 * surfaced through the chat store error channel, as before.
 */
export function useModelSwitch(context: ModelSwitchContext): {
  requestConfirmation: ReturnType<typeof useConfirmationDialog>["requestConfirmation"];
  confirmationDialog: ReturnType<typeof useConfirmationDialog>["confirmationDialog"];
  handleModelSwitch: (nextProvider: ProviderRecord) => void;
  /** Bumped whenever a slash-command wants the model picker to open. */
  switchSignal: number;
  requestSwitchSignal: () => void;
} {
  const { t } = useTranslation();
  const { requestConfirmation, confirmationDialog } = useConfirmationDialog();
  const [switchSignal, setSwitchSignal] = useState(0);
  const switchProvider = useProviderStore((state) => state.switchProvider);

  const finishSwitch = useCallback(
    async (request: ModelSwitchRequest, assessment: ModelSwitchAssessment) => {
      const nextProvider = useProviderStore
        .getState()
        .providers.find((entry) => entry.id === request.toProviderId);
      if (!nextProvider) return;
      const result = await getModelSwitchCoordinator().execute(request, assessment);
      if (result.status !== "switched") {
        useChatStore.setState({
          error: t("chat.modelSwitchBlocked", { reason: result.status }),
        });
        return;
      }
      await switchProvider(nextProvider.id);
      await useChatStore
        .getState()
        .updateConversationProvider(nextProvider.id, nextProvider.modelId);
      if (assessment.requiresModeDowngrade) useChatStore.getState().setMode("agent");
    },
    [switchProvider, t],
  );

  const handleModelSwitch = useCallback(
    (nextProvider: ProviderRecord) => {
      void (async () => {
        try {
          if (!context.conversationId) {
            await switchProvider(nextProvider.id);
            return;
          }
          const request: ModelSwitchRequest = {
            conversationId: context.conversationId,
            privateSession: context.privateSession,
            fromProviderId: context.fromProviderId,
            fromModelId: context.fromModelId,
            toProviderId: nextProvider.id,
            toModelId: nextProvider.modelId,
            requestedAt: Date.now(),
            mode: context.mode as ModelSwitchRequest["mode"],
            hasActiveExecution: context.hasActiveExecution,
          };
          const assessment = await getModelSwitchCoordinator().assess(request);
          if (assessment.status === "blocked") {
            useChatStore.setState({
              error: t("chat.modelSwitchBlocked", {
                reason: assessment.blockReason ?? "unknown",
              }),
            });
            return;
          }
          if (assessment.status === "requires-confirmation") {
            const reasons = [
              ...(assessment.requiresDataDestinationConfirmation
                ? [t("chat.modelSwitchDataDestination", { provider: nextProvider.name })]
                : []),
              ...(assessment.requiresModeDowngrade ? [t("chat.modelSwitchDowngrade")] : []),
            ];
            requestConfirmation(
              {
                title: t("chat.modelSwitchConfirmTitle"),
                description: reasons.join(" "),
                confirmLabel: t("chat.modelSwitchConfirm"),
                tone: "warning",
              },
              () => void finishSwitch(request, assessment),
            );
            return;
          }
          await finishSwitch(request, assessment);
        } catch {
          useChatStore.setState({ error: t("chat.modelSwitchFailed") });
        }
      })();
    },
    [context, finishSwitch, requestConfirmation, switchProvider, t],
  );

  return {
    requestConfirmation,
    confirmationDialog,
    handleModelSwitch,
    switchSignal,
    requestSwitchSignal: () => setSwitchSignal((signal) => signal + 1),
  };
}
