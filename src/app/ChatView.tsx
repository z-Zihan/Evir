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
import { useChatStore, type ChatState } from "../features/chat/chat-store";
import { useShallow } from "zustand/react/shallow";
import { useProviderStore } from "../features/provider/provider-store";
import { ChatMessage } from "./ChatMessage";
import { MarkdownContent } from "./MarkdownContent";
import { ChatEmptyState } from "./ChatEmptyState";
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
import { workspaceResourceTitle } from "../features/workspace/resource-model";
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
  const contextBrowserUrl = useWorkspacePanelStore((state) => state.browserContextUrl);
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
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Stickiness: streaming frames only auto-scroll while the user is already
  // at (near) the bottom, so reading earlier output is never yanked away.
  const stickToBottomRef = useRef(true);

  const handleScroll = useCallback(() => {
    const element = scrollRef.current;
    if (!element) return;
    stickToBottomRef.current = element.scrollHeight - element.scrollTop - element.clientHeight < 80;
  }, []);

  const scrollToBottom = useCallback((force = false) => {
    if (!force && !stickToBottomRef.current) return;
    stickToBottomRef.current = true;
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "auto" });
    });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, streamingContent, latestAgentRun?.updatedAt, scrollToBottom]);

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
    <header className="workspace-header">
      <div className="workspace-heading">
        <button
          className="header-icon-button"
          type="button"
          onClick={onToggleSidebar}
          aria-label={sidebarVisible ? t("sidebar.hide") : t("sidebar.show")}
          data-tip={sidebarVisible ? t("sidebar.hide") : t("sidebar.show")}
        >
          <PanelLeft size={18} aria-hidden="true" />
        </button>
        <div className="workspace-title-block">
          <h1>{conversationTitle}</h1>
          <span className="workspace-context">
            {effectiveProvider
              ? effectiveProvider.name
              : t(runtime.target === "desktop" ? "runtime.desktopLocal" : "runtime.chatOnly")}
          </span>
        </div>
      </div>
      <div className="workspace-controls">
        <button
          className="header-icon-button workspace-toggle"
          type="button"
          onClick={() => togglePanel()}
          aria-label={panelOpen ? t("workspace.close") : t("workspace.open")}
          aria-pressed={panelOpen}
          data-tip={panelOpen ? t("workspace.close") : t("workspace.open")}
        >
          <PanelRight size={18} aria-hidden="true" />
        </button>
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
      <main className="workspace">
        {header}
        <section className="provider-empty-state">
          <div className="provider-empty-icon" aria-hidden="true">
            <KeyRound size={22} />
          </div>
          <div className="provider-empty-copy">
            <span className="empty-eyebrow">{t("chat.readyWhenYouAre")}</span>
            <h2>{t("chat.noProviderTitle")}</h2>
            <p>{t("chat.noProviderDescription")}</p>
          </div>
          <button className="primary-button" type="button" onClick={onOpenSettings}>
            <Settings2 size={16} aria-hidden="true" />
            {t("chat.addProviderFirst")}
          </button>
        </section>
      </main>
    );
  }

  return (
    <main className="workspace">
      {header}
      <div className="messages-area" ref={scrollRef} onScroll={handleScroll}>
        {messages.length === 0 && !isCurrentConversationStreaming ? (
          <ChatEmptyState
            onSendMessage={(content) => {
              scrollToBottom(true);
              void sendMessage(content);
            }}
          />
        ) : (
          <div className="message-list">
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
              <AgentRunSummary record={currentAgentRun} onLayoutChange={scrollToBottom} />
            )}
            {currentAgentRun?.mode === "plan" &&
              projectScoped &&
              (currentAgentRun.status === "completed" ||
                currentAgentRun.status === "needs_verification") &&
              !isCurrentConversationStreaming && (
                <div className="plan-execute-row">
                  <button
                    type="button"
                    className="primary-button"
                    onClick={() => {
                      setMode("agent");
                      scrollToBottom(true);
                      void sendMessage(t("plan.executePrompt"));
                    }}
                  >
                    <Play size={14} aria-hidden="true" />
                    {t("plan.executePlan")}
                  </button>
                  <span className="plan-execute-hint">{t("plan.executeHint")}</span>
                </div>
              )}
            {isCurrentConversationStreaming && (
              <article
                className="message-row message-assistant message-streaming"
                aria-live="polite"
              >
                <div className="message-rail" aria-hidden="true">
                  <span className="message-role-mark">
                    <img src="/evir-mark.svg" alt="" />
                  </span>
                </div>
                <div className="message-main">
                  <header className="message-header">
                    <span className="message-author">Evir</span>
                    <span className="stream-status">
                      <span className="signal-dot" aria-hidden="true" />
                      {streamingContent ? t("chat.responding") : t("chat.preparingResponse")}
                      <time>{t("chat.elapsed", { seconds: streamElapsedSeconds })}</time>
                    </span>
                  </header>
                  <div className="message-content stream-surface">
                    {streamingContent ? (
                      <MarkdownContent content={streamingContent} streaming />
                    ) : (
                      <div className="stream-waiting">
                        <div className="stream-placeholder" aria-hidden="true">
                          <span />
                          <span />
                          <span />
                        </div>
                        {streamElapsedSeconds >= 15 && <p>{t("chat.slowResponse")}</p>}
                      </div>
                    )}
                  </div>
                </div>
              </article>
            )}
          </div>
        )}
      </div>
      {error && !hasMessageError && <div className="chat-error">{displayError(error)}</div>}
      <footer className="composer-wrap">
        <div
          className={`composer${dragOver ? " drag-over" : ""}`}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
        >
          {pendingAttachments.length > 0 && (
            <div className="pending-attachments">
              {pendingAttachments.map((att) =>
                att.type === "image" ? (
                  <div key={att.id} className="pending-attachment-chip">
                    <img src={att.data} alt={att.fileName} className="pending-attachment-thumb" />
                    <button
                      type="button"
                      onClick={() => removeAttachment(att.id)}
                      aria-label={t("chat.removeAttachment")}
                      data-tip={t("chat.removeAttachment")}
                    >
                      <X size={12} />
                    </button>
                  </div>
                ) : (
                  <div key={att.id} className="pending-attachment-chip">
                    <span className="attachment-name">{att.fileName}</span>
                    <button
                      type="button"
                      onClick={() => removeAttachment(att.id)}
                      aria-label={t("chat.removeAttachment")}
                      data-tip={t("chat.removeAttachment")}
                    >
                      <X size={12} />
                    </button>
                  </div>
                ),
              )}
            </div>
          )}
          {selectedSkillIds.size > 0 && (
            <div className="pending-skills" aria-label={t("skill.selectedForMessage")}>
              {installedSkills
                .filter((skill) => selectedSkillIds.has(skill.manifest.id))
                .map((skill) => {
                  const locale = i18n.resolvedLanguage === "zh-CN" ? "zh-CN" : "en";
                  const name = skill.manifest.localizations?.[locale]?.name ?? skill.manifest.name;
                  return (
                    <button
                      key={skill.manifest.id}
                      type="button"
                      className="pending-skill-chip"
                      onClick={() => toggleSelectedSkill(skill.manifest.id)}
                      aria-label={t("skill.removeSelected", { name })}
                    >
                      <Sparkles size={12} aria-hidden="true" />
                      {name}
                      <X size={11} aria-hidden="true" />
                    </button>
                  );
                })}
            </div>
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
            <div className="composer-workspace-context" aria-label={t("workspace.contextLabel")}>
              {contextResource && (
                <span className="workspace-context-chip">
                  <FileText size={12} aria-hidden="true" />
                  <span className="workspace-context-chip-label">
                    {workspaceResourceTitle(contextResource)}
                  </span>
                  <button
                    type="button"
                    aria-label={t("workspace.removeContext")}
                    onClick={() => useWorkspacePanelStore.getState().closePanel()}
                  >
                    <X size={11} aria-hidden="true" />
                  </button>
                </span>
              )}
              {contextBrowserUrl && (
                <span className="workspace-context-chip">
                  <Globe size={12} aria-hidden="true" />
                  <span className="workspace-context-chip-label">
                    {contextBrowserUrl.replace(/^https?:\/\//, "").slice(0, 48)}
                  </span>
                </span>
              )}
            </div>
          )}
          <textarea
            ref={textareaRef}
            aria-label={t("chat.placeholder")}
            placeholder={t("chat.placeholder")}
            value={input}
            onChange={(e) => onInputChange(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isCurrentConversationStreaming}
          />
          <div className="composer-footer">
            <div className="composer-tools">
              <button
                type="button"
                className="composer-tool-button"
                onClick={() => fileInputRef.current?.click()}
                disabled={isCurrentConversationStreaming}
                aria-label={t("chat.attachFile")}
                data-tip={t("chat.attachFile")}
              >
                <Paperclip size={16} />
              </button>

              <SkillPicker
                mode={runtime.target === "web" ? "ask" : effectiveConversationMode}
                disabled={isCurrentConversationStreaming}
              />
            </div>
            <div className="composer-context">
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
                {input.length > 0 && <span className="char-count">{input.length}</span>}
              </span>
            </div>
            {isCurrentConversationStreaming ? (
              <button type="button" className="send-button stop-button" onClick={stopGeneration}>
                <Square size={14} />
                {t("chat.stop")}
              </button>
            ) : (
              <button
                type="button"
                className="send-button"
                aria-label={t("chat.send")}
                disabled={isStreaming || (!input.trim() && pendingAttachments.length === 0)}
                onClick={onSendMessage}
                data-tip={
                  isStreaming && !isCurrentConversationStreaming
                    ? t("chat.streamInProgress")
                    : undefined
                }
              >
                {t("chat.send")}
                <ArrowUp size={15} aria-hidden="true" />
              </button>
            )}
          </div>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            style={{ display: "none" }}
            onChange={(e) => void handleFileSelect(e.target.files)}
            accept="image/*,text/*,.md,.json,.js,.jsx,.ts,.tsx,.py,.rs,.go,.java,.c,.cpp,.h,.css,.html,.xml,.yaml,.yml,.toml,.csv,.sh,.bash,.sql"
          />
        </div>
        <p className="disclaimer">{t("chat.disclaimer")}</p>
      </footer>
      {modelSwitchConfirmation}
    </main>
  );
}
