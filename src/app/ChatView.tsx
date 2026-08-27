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
  Download,
  KeyRound,
  PanelLeft,
  Paperclip,
  Settings2,
  Sparkles,
  Square,
  Play,
  X,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useChatStore } from "../features/chat/chat-store";
import { useProviderStore } from "../features/provider/provider-store";
import { ChatMessage } from "./ChatMessage";
import { ChatEmptyState } from "./ChatEmptyState";
import { ModeSwitcher } from "./ModeSwitcher";
import { ModelSwitcher } from "./ModelSwitcher";
import type { MessageRecord, ProviderRecord } from "../core/storage/db";
import { useDragDrop } from "./use-drag-drop";
import { getRuntime } from "../runtime/use-runtime";
import { handleExportMarkdown } from "./export-helpers";
import { useConversationTokenCount } from "./use-token-count";
import { ModelSwitchCoordinatorImpl } from "../core/providers/model-switch-coordinator-impl";
import type { ModelSwitchRequest } from "../core/providers/model-switching";
import { loadPersonalizationPreferences } from "../features/settings/personalization-settings";
import { AgentRunSummary } from "./AgentRunSummary";
import { useConfirmationDialog } from "./useConfirmationDialog";
import type { ModelSwitchAssessment } from "../core/providers/model-switching";
import { SkillPicker } from "./SkillPicker";
import { useSkillStore } from "../features/skills/skill-store";
import { useMemoryStore } from "../features/memory/memory-store";
import { useOrchestrationStore } from "../features/orchestration/orchestration-store";
import { allowsProjectModes } from "../features/projects/conversation-mode";
// The orchestration workbench (plan DAG, node timeline, clarifications) only
// appears in desktop Agent runs; keep it and its store graph out of the entry
// chunk.
const TaskWorkbench = lazy(() =>
  import("./TaskWorkbench").then((m) => ({ default: m.TaskWorkbench })),
);

const modelSwitchCoordinator = new ModelSwitchCoordinatorImpl();

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
  } = useChatStore();
  const installedSkills = useSkillStore((state) => state.skills);
  const addMemory = useMemoryStore((state) => state.addMemory);
  const orchestrationSnapshot = useOrchestrationStore((state) => state.current);
  const { getDefaultProvider, switchProvider } = useProviderStore();
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
  const conversationTitle = currentConversation?.title || t("chat.title");
  const projectScoped = allowsProjectModes(currentConversation);
  const effectiveConversationMode = projectScoped ? mode : "ask";
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

  const tokenCount = useConversationTokenCount(currentConversationId);
  const hasMessageError = messages.some(
    (message) => message.status === "error" && Boolean(message.errorMessage),
  );
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const scrollToBottom = useCallback(() => {
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
    if (
      e.key === "Enter" &&
      !e.nativeEvent.isComposing &&
      !e.shiftKey &&
      !e.metaKey &&
      !e.ctrlKey
    ) {
      e.preventDefault();
      onSendMessage();
    }
  };

  const handleFileSelect = (files: FileList | null) => {
    if (!files) return;
    for (const file of files) {
      void addAttachment(file);
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const { dragOver, handleDrop, handleDragOver, handleDragLeave } = useDragDrop(handleFileSelect);

  const finishModelSwitch = async (
    request: ModelSwitchRequest,
    assessment: ModelSwitchAssessment,
    nextProvider: ProviderRecord,
  ) => {
    const result = await modelSwitchCoordinator.execute(request, assessment);
    if (result.status !== "switched") {
      useChatStore.setState({
        error: t("chat.modelSwitchBlocked", { reason: result.status }),
      });
      return;
    }
    await switchProvider(nextProvider.id);
    await updateConversationProvider(nextProvider.id, nextProvider.modelId);
    if (assessment.requiresModeDowngrade) setMode("ask");
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
          fromProviderId: provider?.id ?? "",
          fromModelId: provider?.modelId ?? "",
          toProviderId: nextProvider.id,
          toModelId: nextProvider.modelId,
          requestedAt: Date.now(),
          mode,
          hasActiveExecution: isStreaming || pendingToolApproval !== null,
        };
        const assessment = await modelSwitchCoordinator.assess(request);
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
          title={sidebarVisible ? t("sidebar.hide") : t("sidebar.show")}
        >
          <PanelLeft size={18} aria-hidden="true" />
        </button>
        <div className="workspace-title-block">
          <h1>{conversationTitle}</h1>
          <span className="workspace-context">
            {provider
              ? provider.name
              : t(runtime.target === "desktop" ? "runtime.desktopLocal" : "runtime.chatOnly")}
          </span>
        </div>
      </div>
      <div className="workspace-controls">
        <ModelSwitcher onSwitch={handleModelSwitch} />
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
      <div className="messages-area" ref={scrollRef}>
        {messages.length === 0 && !isCurrentConversationStreaming ? (
          <ChatEmptyState onSendMessage={(content) => void sendMessage(content)} />
        ) : (
          <div className="message-list">
            <MessageList
              messages={messages}
              disabled={isStreaming}
              localUserName={localUserName}
              localUserAvatar={localUserAvatar}
              onEdit={editMessage}
              onRegenerate={regenerate}
              {...(!privateSession ? { onRemember: rememberMessage } : {})}
            />
            {mode === "agent" && (
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
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{streamingContent}</ReactMarkdown>
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
                      title={t("chat.removeAttachment")}
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
                      title={t("chat.removeAttachment")}
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
          <textarea
            ref={textareaRef}
            aria-label={t("chat.placeholder")}
            placeholder={t("chat.placeholder")}
            value={input}
            onChange={(e) => onInputChange(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isStreaming}
          />
          <div className="composer-footer">
            <div className="composer-tools">
              <button
                type="button"
                className="composer-tool-button"
                onClick={() => fileInputRef.current?.click()}
                disabled={isStreaming}
                aria-label={t("chat.attachFile")}
                title={t("chat.attachFile")}
              >
                <Paperclip size={16} />
              </button>

              <SkillPicker
                mode={runtime.target === "web" ? "ask" : effectiveConversationMode}
                disabled={isStreaming}
              />

              <button
                type="button"
                className="composer-tool-button"
                onClick={() => void handleExportMarkdown(currentConversationId ?? "")}
                disabled={isStreaming || !currentConversationId}
                aria-label={t("settings.exportMarkdown")}
                title={t("settings.exportMarkdown")}
              >
                <Download size={16} />
              </button>
            </div>
            <div className="composer-context">
              <ModeSwitcher
                mode={mode}
                onModeChange={setMode}
                projectScoped={projectScoped}
                toolCalling={provider?.modelCapabilities?.toolCalling === true}
                onConfigureModel={onOpenSettings}
              />
              <span className="composer-info">
                {input.length > 0 && <span className="char-count">{input.length}</span>}
                {tokenCount > 0 && t("chat.tokenCount", { count: tokenCount })}
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
                disabled={isStreaming || (!input.trim() && pendingAttachments.length === 0)}
                onClick={onSendMessage}
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
            onChange={(e) => handleFileSelect(e.target.files)}
            accept="image/*,text/*,.md,.json,.js,.jsx,.ts,.tsx,.py,.rs,.go,.java,.c,.cpp,.h,.css,.html,.xml,.yaml,.yml,.toml,.csv,.sh,.bash,.sql"
          />
        </div>
        <p className="disclaimer">{t("chat.disclaimer")}</p>
      </footer>
      {modelSwitchConfirmation}
    </main>
  );
}
