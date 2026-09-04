import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { ProviderRecord, ProjectRecord } from "../../core/storage/db";
import type { MessageRecord } from "../../core/storage/db";
import { useChatStore } from "../../features/chat/chat-store";
import { useProjectStore } from "../../features/projects/project-store";
import { useRunWorkspaceStore } from "../../features/workspace/workspace-run-store";
import { useWorkspacePanelStore } from "../../features/workspace/workspace-panel-store";
import { useTraceStore, useTraceDialogStore } from "../../features/tracing/trace-store";
import { useActiveWorkspaceRoot } from "../../features/workspace/workspace-bridge";
import { openTaskOutput } from "../../features/workspace/task-output-resource";
import { writeTextFile } from "../../features/workspace/workspace-services";
import {
  createCanvasDocument,
  serializeCanvasDocument,
} from "../../features/canvas/canvas-document";
import { notify } from "../../components/feedback";
import { getRuntime } from "../../runtime/use-runtime";
import type { SlashActionId, SlashCapabilities } from "../SlashPalette";
import type { SettingsTab } from "../SettingsModal";

export interface UseSlashActionsInput {
  messages: MessageRecord[];
  isStreaming: boolean;
  privateSession: boolean;
  provider: ProviderRecord | undefined;
  conversationProject: ProjectRecord | undefined;
  toolCalling: boolean;
  onNewConversation: () => void;
  onOpenSettings: (tab?: SettingsTab) => void;
}

/**
 * Slash action center wiring (§4-8): availability flags for the palette plus
 * the non-mode action handlers the composer forwards. Kept out of ChatView so
 * the view stays lean and each action is testable in isolation.
 */
export function useSlashActions({
  messages,
  isStreaming,
  privateSession,
  provider,
  conversationProject,
  toolCalling,
  onNewConversation,
  onOpenSettings,
}: UseSlashActionsInput): {
  capabilities: SlashCapabilities;
  handleSlashAction: (id: Exclude<SlashActionId, "plan" | "goal" | "agent" | "model">) => void;
} {
  const { t } = useTranslation();
  const workspaceRoot = useActiveWorkspaceRoot();
  const outputs = useRunWorkspaceStore((state) => state.outputs);
  const traceIdByMessage = useTraceStore((state) => state.traceIdByMessage);

  const lastAssistantMessageId = useMemo(() => {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      if (message?.role === "assistant") return message.id;
    }
    return null;
  }, [messages]);

  const capabilities: SlashCapabilities = {
    desktop: getRuntime().target === "desktop",
    toolCalling,
    canCompact: !isStreaming && !privateSession && messages.length > 6 && Boolean(provider),
    hasOutputs: outputs.length > 0,
    hasTrace:
      lastAssistantMessageId !== null && traceIdByMessage[lastAssistantMessageId] !== undefined,
    hasProjectRoot: workspaceRoot !== null,
  };

  const createCanvasFile = useCallback(async () => {
    if (!workspaceRoot) return;
    const title = t("slash.canvasDefaultTitle");
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const path = `${workspaceRoot}/canvas-${stamp}.evir-canvas`;
    try {
      const document = createCanvasDocument({ title });
      await writeTextFile(path, serializeCanvasDocument(document));
      useWorkspacePanelStore.getState().openResource({ kind: "canvas", path, title });
    } catch {
      notify.error(t("workspace.canvasCreateFailed"));
    }
  }, [workspaceRoot, t]);

  const handleSlashAction = useCallback(
    (id: Exclude<SlashActionId, "plan" | "goal" | "agent" | "model">) => {
      const panel = useWorkspacePanelStore.getState();
      switch (id) {
        case "new-conversation":
          onNewConversation();
          break;
        case "new-project-task": {
          if (!conversationProject || !provider) return;
          useProjectStore.getState().selectProject(conversationProject.id);
          void useChatStore
            .getState()
            .createConversation(provider.id, provider.modelId, conversationProject.id);
          window.dispatchEvent(new Event("evir:focus-composer"));
          break;
        }
        case "compact": {
          const handle = notify.loading(t("chat.compactRunning"));
          void useChatStore
            .getState()
            .compactContext()
            .then((applied) =>
              applied
                ? handle.success(t("chat.compactDone"))
                : handle.error(t("chat.compactUnavailable")),
            );
          break;
        }
        case "open-preview":
          panel.openPanel("preview");
          break;
        case "toggle-browser":
          panel.togglePanel("browser");
          break;
        case "open-outputs":
          panel.openPanel("outputs");
          break;
        case "open-files":
          panel.openPanel("files");
          break;
        case "open-recent-output": {
          const latest = [...useRunWorkspaceStore.getState().outputs].sort(
            (a, b) => b.createdAt - a.createdAt,
          )[0];
          if (latest) openTaskOutput(latest, workspaceRoot);
          break;
        }
        case "open-trace":
          if (lastAssistantMessageId) useTraceDialogStore.getState().open(lastAssistantMessageId);
          break;
        case "new-canvas":
          void createCanvasFile();
          break;
        case "switch-user":
          onOpenSettings("users");
          break;
      }
    },
    [
      conversationProject,
      provider,
      workspaceRoot,
      lastAssistantMessageId,
      onNewConversation,
      onOpenSettings,
      createCanvasFile,
      t,
    ],
  );

  return { capabilities, handleSlashAction };
}
