import {
  memo,
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowUp,
  FileText,
  Globe,
  KeyRound,
  PanelLeft,
  PanelRight,
  Paperclip,
  Settings2,
  Sparkles,
  Square,
  Play,
  X,
} from "lucide-react";
import { Button, Tip } from "../components/ui";
import {
  Message,
  MessageAuthor,
  MessageBody,
  MessageContent,
  MessageHeader,
  MessageRail,
  MessageRoleMark,
  MessageTime,
  PromptInput,
  PromptInputChip,
  PromptInputChips,
  PromptInputContext,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputThumb,
  PromptInputTools,
  ThinkingDots,
} from "../components/ai";
import { useChatStore, type ChatState } from "../features/chat/chat-store";
import { useShallow } from "zustand/react/shallow";
import { useProviderStore } from "../features/provider/provider-store";
import { ChatMessage } from "./ChatMessage";
import { MarkdownContent } from "./MarkdownContent";
import { ChatEmptyState } from "./ChatEmptyState";
import { MessageScroller, type MessageScrollerHandle } from "./MessageScroller";
import { ModeSwitcher } from "./ModeSwitcher";
import { ModelSwitcher } from "./ModelSwitcher";
import type { MessageRecord, ProviderRecord } from "../core/storage/db";
import { useDragDrop } from "./use-drag-drop";
import { getRuntime } from "../runtime/use-runtime";
import { getModelSwitchCoordinator } from "../features/chat/model-switch-service";
import type { ModelSwitchRequest } from "../core/providers/model-switching";
import { loadPersonalizationPreferences } from "../features/settings/personalization-settings";
import { AgentRunSummary } from "./AgentRunSummary";
import { useConfirmationDialog } from "./useConfirmationDialog";
import type { ModelSwitchAssessment } from "../core/providers/model-switching";
import { SkillPicker } from "./SkillPicker";
import { useSkillStore } from "../features/skills/skill-store";
import { useMemoryStore } from "../features/memory/memory-store";
import { useOrchestrationStore } from "../features/orchestration/orchestration-store";
import { allowsProjectModes, effectiveModeForModel } from "../features/projects/conversation-mode";
import { useProjectStore } from "../features/projects/project-store";
import { PermissionSwitcher } from "./PermissionSwitcher";
import { SlashPalette, type SlashPaletteHandle, type SlashCommandId } from "./SlashPalette";
import { useWorkspacePanelStore } from "../features/workspace/workspace-panel-store";
import { useIpcRetryStore } from "../runtime/ipc-retry-store";
import { workspaceResourceTitle } from "../features/workspace/resource-model";
import { formatAnnotationDraft, parseAnnotationPayload } from "../features/workspace/annotation";
import { subscribePanelAnnotations } from "../features/workspace/browser-panel-service";
// The orchestration workbench (plan DAG, node timeline, clarifications) only
// appears in desktop Agent runs; keep it and its store graph out of the entry
// chunk.
const TaskWorkbench = lazy(() =>
  import("./TaskWorkbench").then((m) => ({ default: m.TaskWorkbench })),
);

function useElapsedSeconds(startedAt: number | null): number {
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    if (!startedAt) {
      setSeconds(0);
      return;
    }
    const update = () => setSeconds(Math.max(0, Math.floor((Date.now() - startedAt) / 1_000)));
    update();
    const interval = window.setInterval(update, 1_000);
    return () => window.clearInterval(interval);
  }, [startedAt]);

  return seconds;
}

interface ChatViewProps {
  input: string;
  onInputChange: (input: string) => void;
  onSendMessage: () => void;
  onOpenSettings: () => void;
  onToggleSidebar: () => void;
  sidebarVisible: boolean;
}

interface MessageListProps {
  messages: MessageRecord[];
  disabled: boolean;
  localUserName: string;
  localUserAvatar: string;
  onEdit: (messageId: string, content: string) => Promise<void>;
  onRegenerate: () => Promise<void>;
  onRemember?: (message: MessageRecord) => Promise<void>;
}

/**
 * 连续相同失败重试的判定：无正文 + 单个工具调用 + 失败结果 + 与前一条完全相同的工具和参数。
 * 这些消息在渲染层折叠到第一条卡片上（failedRetryCount），避免聊天流被重复失败刷屏。
 */
/** Field subset ChatView subscribes to (consumed via a shallow selector). */
function pickChatViewFields(state: ChatState) {
  return {
    messages: state.messages,
    mode: state.mode,
    isStreaming: state.isStreaming,
    activeStreamConversationId: state.activeStreamConversationId,
    activeStreamStartedAt: state.activeStreamStartedAt,
    streamingContent: state.streamingContent,
    error: state.error,
    sendMessage: state.sendMessage,
    regenerate: state.regenerate,
    editMessage: state.editMessage,
    stopGeneration: state.stopGeneration,
    pendingAttachments: state.pendingAttachments,
    addAttachment: state.addAttachment,
    removeAttachment: state.removeAttachment,
    setMode: state.setMode,
    updateConversationProvider: state.updateConversationProvider,
    currentConversationId: state.currentConversationId,
    conversations: state.conversations,
    latestAgentRun: state.latestAgentRun,
    pendingToolApproval: state.pendingToolApproval,
    selectedSkillIds: state.selectedSkillIds,
    toggleSelectedSkill: state.toggleSelectedSkill,
    privateSession: state.privateSession,
  };
}

function isDuplicateFailedRetry(previous: MessageRecord, message: MessageRecord): boolean {
  if (message.role !== "assistant" || previous.role !== "assistant") return false;
  if (message.content.trim() || previous.content.trim()) return false;
  const call = message.toolCalls?.[0];
  const previousCall = previous.toolCalls?.[0];
  if (!call || !previousCall) return false;
  if ((message.toolCalls?.length ?? 0) !== 1 || (previous.toolCalls?.length ?? 0) !== 1)
    return false;
  const failed = message.toolResults?.some(({ success }) => !success);
  if (!failed) return false;
  return (
    call.toolName === previousCall.toolName &&
    JSON.stringify(call.arguments) === JSON.stringify(previousCall.arguments)
  );
}

export const MessageList = memo(function MessageList({
  messages,
  disabled,
  localUserName,
  localUserAvatar,
  onEdit,
  onRegenerate,
  onRemember,
}: MessageListProps) {
  const hiddenIds = new Set<string>();
  const retryCountById = new Map<string, number>();
  for (let index = 1; index < messages.length; index += 1) {
    const message = messages[index];
    if (!message) continue;
    const previous = messages[index - 1];
    if (!previous) continue;
    if (!isDuplicateFailedRetry(previous, message)) continue;
    hiddenIds.add(message.id);
    const anchor = previous.id;
    const anchorCount = retryCountById.get(anchor);
    if (anchorCount !== undefined) retryCountById.set(anchor, anchorCount + 1);
    else if (!hiddenIds.has(anchor)) retryCountById.set(anchor, 1);
  }
  const visibleMessages = messages.filter((message) => !hiddenIds.has(message.id));

  return (
    <>
      {visibleMessages.map((msg, index) => {
        const previous = visibleMessages[index - 1];
        const next = visibleMessages[index + 1];
        const groupedWithPrevious = msg.role === "assistant" && previous?.role === "assistant";
        const groupedWithNext = msg.role === "assistant" && next?.role === "assistant";
        return (
          <ChatMessage
            key={msg.id}
            message={msg}
            groupedWithPrevious={groupedWithPrevious}
            groupedWithNext={groupedWithNext}
            disabled={disabled}
            localUserName={localUserName}
            localUserAvatar={localUserAvatar}
            failedRetryCount={retryCountById.get(msg.id)}
            onEdit={onEdit}
            onRegenerate={onRegenerate}
            {...(onRemember ? { onRemember } : {})}
          />
        );
      })}
    </>
  );
});

export function ChatView({
  input,
  onInputChange,
  onSendMessage,
  onOpenSettings,
  onToggleSidebar,
  sidebarVisible,
}: ChatViewProps) {
  const { t, i18n } = useTranslation();
  // useShallow group: ChatView legitimately re-renders on stream deltas (it
  // renders streamingContent), but must not re-render on unrelated chat-store
  // fields (e.g. a pending approval in another conversation).
  const {
    messages,
    mode,
    isStreaming,
    activeStreamConversationId,
    activeStreamStartedAt,
    streamingContent,
    error,
    sendMessage,
    regenerate,
    editMessage,
    stopGeneration,
    pendingAttachments,
    addAttachment,
    removeAttachment,
    setMode,
    updateConversationProvider,
    currentConversationId,
    conversations,
    latestAgentRun,
    pendingToolApproval,
    selectedSkillIds,
    toggleSelectedSkill,
    privateSession,
  } = useChatStore(useShallow(pickChatViewFields));
  const installedSkills = useSkillStore((state) => state.skills);
  const addMemory = useMemoryStore((state) => state.addMemory);
  const orchestrationSnapshot = useOrchestrationStore((state) => state.current);
  const panelOpen = useWorkspacePanelStore((state) => state.open);
  const togglePanel = useWorkspacePanelStore((state) => state.togglePanel);
  const contextResource = useWorkspacePanelStore((state) =>
    state.open && state.activeTab === "preview" ? state.activeResource : null,
  );
  // Only surface the browser chip while the browser tab is actually on
  // screen; the URL otherwise lingers above the composer after closing.
  const contextBrowserUrl = useWorkspacePanelStore((state) =>
    state.open && state.activeTab === "browser" ? state.browserContextUrl : null,
  );
  const getDefaultProvider = useProviderStore((state) => state.getDefaultProvider);
  const switchProvider = useProviderStore((state) => state.switchProvider);
  const providers = useProviderStore((state) => state.providers);
  const projects = useProjectStore((state) => state.projects);
  const [localDisplayName, setLocalDisplayName] = useState("");
  const [localUserAvatar, setLocalUserAvatar] = useState("");
  const {
    requestConfirmation: requestModelSwitchConfirmation,
    confirmationDialog: modelSwitchConfirmation,
  } = useConfirmationDialog();

  const provider = getDefaultProvider();
  const runtime = getRuntime();
  const currentConversation = conversations.find(
    (conversation) => conversation.id === currentConversationId,
  );
  // The header must reflect the model this conversation actually uses, which
  // may differ from the default provider after an in-chat switch.
  const effectiveProvider =
    (currentConversation
      ? providers.find((entry) => entry.id === currentConversation.providerId)
      : undefined) ?? provider;
  const effectiveModelId = currentConversation?.modelId ?? effectiveProvider?.modelId;
  const conversationTitle = currentConversation?.title || t("chat.title");
  const projectScoped = allowsProjectModes(currentConversation);
  const conversationProject = currentConversation?.projectId
    ? projects.find((project) => project.id === currentConversation.projectId)
    : undefined;
  const toolCalling = provider?.modelCapabilities?.toolCalling === true;
  const effectiveConversationMode =
    runtime.target === "web"
      ? "ask"
      : effectiveModeForModel(currentConversation, mode, toolCalling);
  const isCurrentConversationStreaming =
    isStreaming && activeStreamConversationId === currentConversationId;
  const currentAgentRun =
    latestAgentRun?.conversationId === currentConversationId ? latestAgentRun : undefined;
  const hasCurrentTaskWorkbench =
    (mode === "agent" || mode === "goal") &&
    orchestrationSnapshot?.conversationId === currentConversationId;
  const streamElapsedSeconds = useElapsedSeconds(
    isCurrentConversationStreaming ? activeStreamStartedAt : null,
  );
  // Honest status while a read-only IPC invoke is being re-issued after the
  // macOS ipc:// stall — replaces the generic "responding…" hint for this
  // conversation until the retry resolves (see ipc-retry-store.ts).
  const ipcRetrying = useIpcRetryStore((state) => {
    if (!currentConversationId) return undefined;
    for (const entry of Object.values(state.retries)) {
      if (entry.conversationId === currentConversationId) return entry;
    }
    return undefined;
  });
  // "/" command palette state: hidden until the user retypes after Escape.
  const slashPaletteRef = useRef<SlashPaletteHandle>(null);
  const [slashDismissed, setSlashDismissed] = useState(false);
  const [modelSwitchSignal, setModelSwitchSignal] = useState(0);
  const slashOpen = input.startsWith("/") && !slashDismissed && !isCurrentConversationStreaming;
  const rememberMessage = useCallback(
    async (message: MessageRecord) => {
      const content = message.content.trim().slice(0, 4_000);
      const firstLine = content.split("\n", 1)[0]?.trim() ?? "";
      await addMemory({
        type: "conversation",
        scope: message.conversationId,
        key: firstLine.slice(0, 80) || t("memory.savedMessage"),
        content,
        source: {
          kind: "manual",
          conversationId: message.conversationId,
          messageIds: [message.id],
        },
      });
    },
    [addMemory, t],
  );

  const hasMessageError = messages.some(
    (message) => message.status === "error" && Boolean(message.errorMessage),
  );
  const scrollerRef = useRef<MessageScrollerHandle>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // Draft mirror for the annotation listener (avoids re-subscribing per keystroke).
  const inputRef = useRef(input);
  inputRef.current = input;
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Display-only escape hatch for the scroll owner: existing force-scroll
  // call sites (send, Execute Plan) keep working through the ref handle.
  const scrollToBottom = useCallback((force = false) => {
    scrollerRef.current?.scrollToBottom(force);
  }, []);
  // streamKey signals "new content arrived" to MessageScroller without handing
  // it any domain state: message count, streaming delta identity (bumped on
  // every new streamingContent reference), and the latest run's update stamp.
  const streamDeltaRef = useRef(0);
  const lastStreamingContentRef = useRef(streamingContent);
  if (lastStreamingContentRef.current !== streamingContent) {
    lastStreamingContentRef.current = streamingContent;
    streamDeltaRef.current += 1;
  }
  const streamKey = `${messages.length}:${streamDeltaRef.current}:${latestAgentRun?.updatedAt ?? 0}`;

  const displayError = (value: string) => (i18n.exists(value) ? t(value) : value);

  useEffect(() => {
    let mounted = true;
    const loadLocalIdentity = () => {
      void loadPersonalizationPreferences()
        .then((preferences) => {
          if (mounted) setLocalDisplayName(preferences.displayName.trim());
          if (mounted) setLocalUserAvatar(preferences.avatarImage);
        })
        .catch(() => {
          if (mounted) setLocalDisplayName("");
          if (mounted) setLocalUserAvatar("");
        });
    };
    loadLocalIdentity();
    window.addEventListener("evir:personalization-updated", loadLocalIdentity);
    return () => {
      mounted = false;
      window.removeEventListener("evir:personalization-updated", loadLocalIdentity);
    };
  }, []);

  useEffect(() => {
    const focusComposer = () => textareaRef.current?.focus();
    window.addEventListener("evir:focus-composer", focusComposer);
    return () => window.removeEventListener("evir:focus-composer", focusComposer);
  }, []);

  // Browser Annotation (§37): a picked element arrives as a structured
  // payload and becomes a Browser Feedback draft the user completes and
  // sends — never an automatic message.
  useEffect(() => {
    const unsubscribe = subscribePanelAnnotations((raw) => {
      const payload = parseAnnotationPayload(raw);
      if (!payload) return;
      const draft = formatAnnotationDraft(payload, {
        header: t("workspace.annotation.header"),
        url: t("workspace.annotation.url"),
        element: t("workspace.annotation.element"),
        box: t("workspace.annotation.box"),
        comment: t("workspace.annotation.comment"),
      });
      onInputChange(`${inputRef.current ? `${inputRef.current}\n` : ""}${draft}`);
      textareaRef.current?.focus();
    }).catch(() => undefined);
    return () => {
      void unsubscribe.then((fn) => fn?.());
    };
  }, [onInputChange, t]);

  const localUserName = localDisplayName || t("chat.localUser");

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // 输入法组词中的 Enter 是确认候选词，不是发送
    const composing = e.nativeEvent.isComposing;
    if (slashOpen && !composing) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        slashPaletteRef.current?.move(1);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        slashPaletteRef.current?.move(-1);
        return;
      }
      if (e.key === "Enter" && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        if (slashPaletteRef.current?.execute()) return;
        // 无匹配项时按普通文本发送
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setSlashDismissed(true);
        return;
      }
    }
    if (e.key === "Enter" && !composing && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      onSendMessage();
    }
  };

  useEffect(() => {
    if (!input.startsWith("/")) setSlashDismissed(false);
  }, [input]);

  const handleSlashCommand = (id: SlashCommandId) => {
    if (id === "plan") setMode("plan");
    if (id === "goal") setMode("goal");
    if (id === "agent") setMode("agent");
    if (id === "model") setModelSwitchSignal((signal) => signal + 1);
    onInputChange("");
    setSlashDismissed(false);
  };

  const handleFileSelect = async (files: FileList | null) => {
    if (!files) return;
    // Preserve selection order and avoid racing async FileReader completions.
    // Concurrent additions can otherwise overwrite each other in the store.
    for (const file of Array.from(files)) {
      await addAttachment(file);
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const { dragOver, handleDrop, handleDragOver, handleDragLeave } = useDragDrop((files) => {
    void handleFileSelect(files);
  });

  const finishModelSwitch = async (
    request: ModelSwitchRequest,
    assessment: ModelSwitchAssessment,
    nextProvider: ProviderRecord,
  ) => {
    const result = await getModelSwitchCoordinator().execute(request, assessment);
    if (result.status !== "switched") {
      useChatStore.setState({
        error: t("chat.modelSwitchBlocked", { reason: result.status }),
      });
      return;
    }
    await switchProvider(nextProvider.id);
    await updateConversationProvider(nextProvider.id, nextProvider.modelId);
    if (assessment.requiresModeDowngrade) setMode("agent");
  };

  const handleModelSwitch = (nextProvider: ProviderRecord) => {
    void (async () => {
      try {
        if (!currentConversationId) {
          await switchProvider(nextProvider.id);
          return;
        }
        const request: ModelSwitchRequest = {
          conversationId: currentConversationId,
          privateSession,
          fromProviderId: effectiveProvider?.id ?? "",
          fromModelId: effectiveModelId ?? "",
          toProviderId: nextProvider.id,
          toModelId: nextProvider.modelId,
          requestedAt: Date.now(),
          mode,
          hasActiveExecution: isStreaming || pendingToolApproval !== null,
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
          requestModelSwitchConfirmation(
            {
              title: t("chat.modelSwitchConfirmTitle"),
              description: reasons.join(" "),
              confirmLabel: t("chat.modelSwitchConfirm"),
              tone: "warning",
            },
            () => finishModelSwitch(request, assessment, nextProvider),
          );
          return;
        }
        await finishModelSwitch(request, assessment, nextProvider);
      } catch {
        useChatStore.setState({ error: t("chat.modelSwitchFailed") });
      }
    })();
  };

  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
  }, [input]);

  const header = (
    <header className="workspace-header flex h-12 shrink-0 items-center justify-between gap-2 border-b border-border px-3">
      <div className="workspace-heading flex min-w-0 items-center gap-1.5">
        <Tip content={sidebarVisible ? t("sidebar.hide") : t("sidebar.show")} side="bottom">
          <Button
            variant="ghost"
            size="icon"
            type="button"
            className="header-icon-button"
            onClick={onToggleSidebar}
            aria-label={sidebarVisible ? t("sidebar.hide") : t("sidebar.show")}
          >
            <PanelLeft size={17} aria-hidden="true" />
          </Button>
        </Tip>
        <div className="workspace-title-block flex min-w-0 flex-col leading-tight">
          <h1 className="truncate text-[13px] font-semibold text-foreground">
            {conversationTitle}
          </h1>
          <span className="workspace-context truncate text-[10.5px] text-muted">
            {effectiveProvider
              ? effectiveProvider.name
              : t(runtime.target === "desktop" ? "runtime.desktopLocal" : "runtime.chatOnly")}
          </span>
        </div>
      </div>
      <div className="workspace-controls flex shrink-0 items-center gap-1.5">
        {runtime.target === "desktop" && (
          <Tip content={panelOpen ? t("workspace.close") : t("workspace.open")} side="bottom">
            <Button
              variant="ghost"
              size="icon"
              type="button"
              className="header-icon-button workspace-toggle"
              onClick={() => togglePanel()}
              aria-label={panelOpen ? t("workspace.close") : t("workspace.open")}
              aria-pressed={panelOpen}
            >
              <PanelRight size={17} aria-hidden="true" />
            </Button>
          </Tip>
        )}
        <ModelSwitcher
          activeProvider={effectiveProvider}
          activeModelId={effectiveModelId}
          openSignal={modelSwitchSignal}
          onSwitch={handleModelSwitch}
          onSwitchModel={(switchProviderRecord, modelId) =>
            handleModelSwitch({ ...switchProviderRecord, modelId })
          }
        />
      </div>
    </header>
  );

  if (!provider) {
    return (
      <main className="workspace flex min-w-0 flex-1 flex-col">
        {header}
        <section className="provider-empty-state flex flex-1 flex-col items-center justify-center gap-3 px-6 py-12 text-center">
          <div
            className="provider-empty-icon grid size-11 place-items-center rounded-xl border border-border bg-surface text-muted"
            aria-hidden="true"
          >
            <KeyRound size={20} />
          </div>
          <div className="provider-empty-copy flex flex-col gap-1">
            <span className="empty-eyebrow text-[11px] font-medium tracking-wide text-muted uppercase">
              {t("chat.readyWhenYouAre")}
            </span>
            <h2 className="text-[17px] font-semibold text-foreground">
              {t("chat.noProviderTitle")}
            </h2>
            <p className="max-w-[380px] text-[12.5px] text-muted">
              {t("chat.noProviderDescription")}
            </p>
          </div>
          <Button variant="primary" size="default" type="button" onClick={onOpenSettings}>
            <Settings2 size={15} aria-hidden="true" />
            {t("chat.addProviderFirst")}
          </Button>
        </section>
      </main>
    );
  }

  return (
    <main className="workspace flex min-w-0 flex-1 flex-col">
      {header}
      <MessageScroller
        ref={scrollerRef}
        streamKey={streamKey}
        className="messages-area min-h-0 min-w-0 flex-1 overflow-y-auto px-6 pt-8 pb-4"
      >
        {messages.length === 0 && !isCurrentConversationStreaming ? (
          <ChatEmptyState
            onSendMessage={(content) => {
              scrollToBottom(true);
              void sendMessage(content);
            }}
          />
        ) : (
          <div className="message-list mx-auto flex w-full min-w-0 max-w-[760px] flex-col gap-5">
            <MessageList
              messages={messages}
              disabled={isCurrentConversationStreaming}
              localUserName={localUserName}
              localUserAvatar={localUserAvatar}
              onEdit={editMessage}
              onRegenerate={regenerate}
              {...(!privateSession ? { onRemember: rememberMessage } : {})}
            />
            {(mode === "agent" || mode === "goal") && (
              <Suspense fallback={null}>
                <TaskWorkbench agentRun={currentAgentRun} />
              </Suspense>
            )}
            {currentAgentRun && !hasCurrentTaskWorkbench && (
              <div className="ml-[34px] min-w-0 max-w-[820px]">
                <AgentRunSummary record={currentAgentRun} onLayoutChange={scrollToBottom} />
              </div>
            )}
            {currentAgentRun?.mode === "plan" &&
              projectScoped &&
              (currentAgentRun.status === "completed" ||
                currentAgentRun.status === "needs_verification") &&
              !isCurrentConversationStreaming && (
                <div className="plan-execute-row mt-2 flex items-center gap-3">
                  <Button
                    type="button"
                    variant="primary"
                    size="default"
                    onClick={() => {
                      setMode("agent");
                      scrollToBottom(true);
                      void sendMessage(t("plan.executePrompt"));
                    }}
                  >
                    <Play size={14} aria-hidden="true" />
                    {t("plan.executePlan")}
                  </Button>
                  <span className="plan-execute-hint text-[12px] text-muted">
                    {t("plan.executeHint")}
                  </span>
                </div>
              )}
            {isCurrentConversationStreaming && (
              <Message role="assistant" className="message-streaming py-1.5" aria-live="polite">
                <MessageRail>
                  <MessageRoleMark>
                    <img src="/evir-mark.svg" alt="" className="size-full" />
                  </MessageRoleMark>
                </MessageRail>
                <MessageBody className="flex-1">
                  <MessageHeader>
                    <MessageAuthor>Evir</MessageAuthor>
                    <span className="stream-status flex items-center gap-1.5 text-[11px] text-muted">
                      <span
                        className="signal-dot size-1.5 animate-pulse rounded-full bg-success"
                        aria-hidden="true"
                      />
                      {ipcRetrying
                        ? t("chat.ipcRetrying")
                        : streamingContent
                          ? t("chat.responding")
                          : t("chat.preparingResponse")}
                      <MessageTime>
                        {t("chat.elapsed", { seconds: streamElapsedSeconds })}
                      </MessageTime>
                    </span>
                  </MessageHeader>
                  <MessageContent role="assistant" className="stream-surface">
                    {streamingContent ? (
                      <MarkdownContent content={streamingContent} streaming />
                    ) : (
                      <div className="stream-waiting">
                        <ThinkingDots />
                        {streamElapsedSeconds >= 15 && (
                          <p className="text-[12px] text-muted">{t("chat.slowResponse")}</p>
                        )}
                      </div>
                    )}
                  </MessageContent>
                </MessageBody>
              </Message>
            )}
          </div>
        )}
      </MessageScroller>
      {error && !hasMessageError && (
        <div className="chat-error mx-4 mb-1.5 rounded-lg border border-danger/35 bg-danger/[0.07] px-3 py-2 text-[12px] text-danger">
          {displayError(error)}
        </div>
      )}
      <footer className="composer-wrap mx-auto w-full min-w-0 max-w-[760px] px-0 pb-3 pt-1.5 max-[860px]:px-4">
        <PromptInput
          className={dragOver ? "drag-over border-primary/60 shadow-sm" : undefined}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
        >
          {(pendingAttachments.length > 0 || selectedSkillIds.size > 0) && (
            <PromptInputChips className={selectedSkillIds.size === 0 ? "" : "flex-wrap gap-y-1"}>
              {pendingAttachments.map((att) =>
                att.type === "image" ? (
                  <PromptInputChip
                    key={att.id}
                    media={<PromptInputThumb src={att.data} alt={att.fileName} />}
                    removeLabel={t("chat.removeAttachment")}
                    onRemove={() => removeAttachment(att.id)}
                  >
                    {att.fileName}
                  </PromptInputChip>
                ) : (
                  <PromptInputChip
                    key={att.id}
                    removeLabel={t("chat.removeAttachment")}
                    onRemove={() => removeAttachment(att.id)}
                  >
                    {att.fileName}
                  </PromptInputChip>
                ),
              )}
              {selectedSkillIds.size > 0 &&
                installedSkills
                  .filter((skill) => selectedSkillIds.has(skill.manifest.id))
                  .map((skill) => {
                    const locale = i18n.resolvedLanguage === "zh-CN" ? "zh-CN" : "en";
                    const name =
                      skill.manifest.localizations?.[locale]?.name ?? skill.manifest.name;
                    return (
                      <PromptInputChip
                        key={skill.manifest.id}
                        media={<Sparkles size={11} aria-hidden="true" className="text-primary" />}
                        removeLabel={t("skill.removeSelected", { name })}
                        onRemove={() => toggleSelectedSkill(skill.manifest.id)}
                        className="pending-skill-chip border-primary/30 bg-primary/[0.06]"
                      >
                        {name}
                      </PromptInputChip>
                    );
                  })}
            </PromptInputChips>
          )}
          {slashOpen && (
            <SlashPalette
              ref={slashPaletteRef}
              query={input.slice(1)}
              projectScoped={projectScoped && runtime.target !== "web"}
              onCommand={handleSlashCommand}
              onDone={() => {
                onInputChange("");
                setSlashDismissed(false);
              }}
            />
          )}
          {(contextResource || contextBrowserUrl) && (
            <div
              className="composer-workspace-context flex flex-wrap items-center gap-1.5 px-3 pt-2.5"
              aria-label={t("workspace.contextLabel")}
            >
              {contextResource && (
                <span className="workspace-context-chip inline-flex max-w-[240px] items-center gap-1.5 rounded-md border border-border bg-surface-hover py-1 pr-1 pl-2 text-[11.5px]">
                  <FileText size={11} aria-hidden="true" className="shrink-0 text-muted" />
                  <span className="workspace-context-chip-label truncate">
                    {workspaceResourceTitle(contextResource)}
                  </span>
                  <button
                    type="button"
                    className="grid size-5 shrink-0 cursor-pointer place-items-center rounded-sm text-muted hover:bg-surface hover:text-foreground"
                    aria-label={t("workspace.removeContext")}
                    onClick={() => useWorkspacePanelStore.getState().closePanel()}
                  >
                    <X size={11} aria-hidden="true" />
                  </button>
                </span>
              )}
              {contextBrowserUrl && (
                <span className="workspace-context-chip inline-flex max-w-[240px] items-center gap-1.5 rounded-md border border-border bg-surface-hover py-1 px-2 text-[11.5px]">
                  <Globe size={11} aria-hidden="true" className="shrink-0 text-muted" />
                  <span className="workspace-context-chip-label truncate">
                    {contextBrowserUrl.replace(/^https?:\/\//, "").slice(0, 48)}
                  </span>
                </span>
              )}
            </div>
          )}
          <PromptInputTextarea
            ref={textareaRef}
            aria-label={t("chat.placeholder")}
            placeholder={t("chat.placeholder")}
            value={input}
            onChange={(e) => onInputChange(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isCurrentConversationStreaming}
          />
          <PromptInputFooter>
            <PromptInputTools>
              <Tip content={t("chat.attachFile")}>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="text-muted hover:text-foreground"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isCurrentConversationStreaming}
                  aria-label={t("chat.attachFile")}
                >
                  <Paperclip size={15} />
                </Button>
              </Tip>

              <SkillPicker
                mode={runtime.target === "web" ? "ask" : effectiveConversationMode}
                disabled={isCurrentConversationStreaming}
              />
            </PromptInputTools>
            <PromptInputContext>
              {projectScoped && runtime.target === "desktop" && conversationProject && (
                <PermissionSwitcher project={conversationProject} />
              )}
              <ModeSwitcher
                mode={mode}
                onModeChange={setMode}
                projectScoped={projectScoped}
                toolCalling={toolCalling}
                onConfigureModel={onOpenSettings}
              />
              <span className="composer-info">
                {input.length > 0 && (
                  <span className="char-count text-[10.5px] text-muted/80">{input.length}</span>
                )}
              </span>
              {isCurrentConversationStreaming ? (
                <PromptInputSubmit
                  streaming
                  type="button"
                  aria-label={t("chat.stop")}
                  onClick={(event) => {
                    // The send button morphs into Stop after the first click. Ignore the
                    // second click of the same physical double-click so a rapid submit
                    // cannot immediately cancel the request it just started.
                    if (event.detail > 1) return;
                    stopGeneration(currentConversationId ?? undefined);
                  }}
                >
                  <Square size={13} />
                  {t("chat.stop")}
                </PromptInputSubmit>
              ) : (
                <PromptInputSubmit
                  type="button"
                  aria-label={t("chat.send")}
                  disabled={!input.trim() && pendingAttachments.length === 0}
                  onClick={onSendMessage}
                >
                  {t("chat.send")}
                  <ArrowUp size={14} aria-hidden="true" />
                </PromptInputSubmit>
              )}
            </PromptInputContext>
          </PromptInputFooter>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            style={{ display: "none" }}
            onChange={(e) => void handleFileSelect(e.target.files)}
            accept="image/*,text/*,.md,.json,.js,.jsx,.ts,.tsx,.py,.rs,.go,.java,.c,.cpp,.h,.css,.html,.xml,.yaml,.yml,.toml,.csv,.sh,.bash,.sql"
          />
        </PromptInput>
        <p className="disclaimer px-1 pt-1.5 text-center text-[10.5px] text-muted/70">
          {t("chat.disclaimer")}
        </p>
      </footer>
      {modelSwitchConfirmation}
    </main>
  );
}
