import {
  memo,
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import { KeyRound, Play, Settings2 } from "lucide-react";
import { Button } from "../components/ui";
import {
  Message,
  MessageContent,
  MessageRail,
  MessageRoleMark,
  ThinkingDots,
} from "../components/ai";
import { useChatStore, type ChatState } from "../features/chat/chat-store";
import { useShallow } from "zustand/react/shallow";
import { useProviderStore } from "../features/provider/provider-store";
import { useMemoryStore } from "../features/memory/memory-store";
import { ChatMessage } from "./ChatMessage";
import { MarkdownContent } from "./MarkdownContent";
import { ChatEmptyState } from "./ChatEmptyState";
import { MessageScroller, type MessageScrollerHandle } from "./MessageScroller";
import type { MessageRecord } from "../core/storage/db";
import { getRuntime } from "../runtime/use-runtime";
import { useOrchestrationStore } from "../features/orchestration/orchestration-store";
import { allowsProjectModes, effectiveModeForModel } from "../features/projects/conversation-mode";
import { useProjectStore } from "../features/projects/project-store";
import { useIpcRetryStore } from "../runtime/ipc-retry-store";
import { useWorkspacePanelStore } from "../features/workspace/workspace-panel-store";
import { useLocalIdentity } from "./chat/use-local-identity";
import { useModelSwitch } from "./chat/use-model-switch";
import { ChatHeader } from "./chat/ChatHeader";
import { ChatComposer } from "./chat/ChatComposer";
import { AgentRunSummary } from "./AgentRunSummary";
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
    setMode: state.setMode,
    currentConversationId: state.currentConversationId,
    conversations: state.conversations,
    latestAgentRun: state.latestAgentRun,
    pendingToolApproval: state.pendingToolApproval,
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
  const { t } = useTranslation();
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
    setMode,
    currentConversationId,
    conversations,
    latestAgentRun,
    pendingToolApproval,
    privateSession,
  } = useChatStore(useShallow(pickChatViewFields));
  const getDefaultProvider = useProviderStore((state) => state.getDefaultProvider);
  const providers = useProviderStore((state) => state.providers);
  const projects = useProjectStore((state) => state.projects);
  const orchestrationSnapshot = useOrchestrationStore((state) => state.current);
  const panelOpen = useWorkspacePanelStore((state) => state.open);
  const togglePanel = useWorkspacePanelStore((state) => state.togglePanel);
  const { displayName: localDisplayName, avatar: localUserAvatar } = useLocalIdentity();
  const addMemory = useMemoryStore((state) => state.addMemory);

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

  const {
    confirmationDialog: modelSwitchConfirmation,
    handleModelSwitch,
    switchSignal,
    requestSwitchSignal,
  } = useModelSwitch({
    conversationId: currentConversationId,
    privateSession,
    fromProviderId: effectiveProvider?.id ?? "",
    fromModelId: effectiveModelId ?? "",
    mode,
    hasActiveExecution: isStreaming || pendingToolApproval !== null,
  });

  const hasMessageError = messages.some(
    (message) => message.status === "error" && Boolean(message.errorMessage),
  );
  const scrollerRef = useRef<MessageScrollerHandle>(null);
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

  const localUserName = localDisplayName || t("chat.localUser");

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

  const header = (
    <ChatHeader
      title={conversationTitle}
      providerName={effectiveProvider?.name}
      runtimeCaption={
        runtime.target === "desktop" ? t("runtime.desktopLocal") : t("runtime.chatOnly")
      }
      sidebarVisible={sidebarVisible}
      onToggleSidebar={onToggleSidebar}
      panelOpen={panelOpen}
      onTogglePanel={() => togglePanel()}
      isDesktop={runtime.target === "desktop"}
      activeProvider={effectiveProvider}
      activeModelId={effectiveModelId}
      modelSwitchSignal={switchSignal}
      onModelSwitch={handleModelSwitch}
      onSwitchModel={(switchProviderRecord, modelId) =>
        handleModelSwitch({ ...switchProviderRecord, modelId })
      }
    />
  );

  const errorBanner = error && !hasMessageError ? <StreamErrorStrip error={error} /> : null;

  if (!provider) {
    return (
      <main className="workspace flex min-h-0 min-w-0 flex-1 flex-col">
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
    <main className="workspace flex min-h-0 min-w-0 flex-1 flex-col">
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
              <div className="ml-8 min-w-0 max-w-[calc(95%-44px)]">
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
              <StreamingRow
                ipcRetrying={Boolean(ipcRetrying)}
                content={streamingContent ?? ""}
                elapsedSeconds={streamElapsedSeconds}
              />
            )}
          </div>
        )}
      </MessageScroller>
      <ChatComposer
        input={input}
        onInputChange={onInputChange}
        onSendMessage={onSendMessage}
        onStop={() =>
          void useChatStore.getState().stopGeneration(currentConversationId ?? undefined)
        }
        streaming={isCurrentConversationStreaming}
        mode={mode}
        onModeChange={setMode}
        effectiveMode={effectiveConversationMode}
        projectScoped={projectScoped}
        toolCalling={toolCalling}
        isWebTarget={runtime.target === "web"}
        conversationProject={conversationProject}
        onOpenSettings={onOpenSettings}
        onModelSwitchCommand={requestSwitchSignal}
        errorBanner={errorBanner}
      />
      {modelSwitchConfirmation}
    </main>
  );
}

/** Streaming assistant row: Evir mark rail + status header + live content. */
function StreamingRow({
  ipcRetrying,
  content,
  elapsedSeconds,
}: {
  ipcRetrying: boolean;
  content: string;
  elapsedSeconds: number;
}) {
  const { t } = useTranslation();
  return (
    <Message from="assistant" className="message-streaming py-1.5" aria-live="polite">
      <MessageRail>
        <MessageRoleMark>
          <img src="/evir-mark.svg" alt="" className="size-full" />
        </MessageRoleMark>
      </MessageRail>
      <div className="message-main flex min-w-0 flex-1 flex-col gap-1">
        <div className="message-header flex h-5 items-center gap-2 text-[11px] text-muted">
          <span className="message-author font-medium text-foreground/85">Evir</span>
          <span className="stream-status flex items-center gap-1.5 text-[11px] text-muted">
            <span
              className="signal-dot size-1.5 animate-pulse rounded-full bg-success"
              aria-hidden="true"
            />
            {ipcRetrying
              ? t("chat.ipcRetrying")
              : content
                ? t("chat.responding")
                : t("chat.preparingResponse")}
            <time className="text-muted">{t("chat.elapsed", { seconds: elapsedSeconds })}</time>
          </span>
        </div>
        <MessageContent className="stream-surface w-full">
          {content ? (
            <MarkdownContent content={content} streaming />
          ) : (
            <div className="stream-waiting">
              <ThinkingDots />
              {elapsedSeconds >= 15 && (
                <p className="text-[12px] text-muted">{t("chat.slowResponse")}</p>
              )}
            </div>
          )}
        </MessageContent>
      </div>
    </Message>
  );
}

/** The stream/chat error strip, docked to the 760px composer column. */
function StreamErrorStrip({ error }: { error: string }): ReactNode {
  const { t, i18n } = useTranslation();
  const displayError = (value: string) => (i18n.exists(value) ? t(value) : value);
  return (
    <div className="chat-error mb-1.5 flex items-start gap-1.5 rounded-lg border border-danger/35 bg-danger/[0.07] px-3 py-2 text-[12px] leading-relaxed text-danger">
      {displayError(error)}
    </div>
  );
}
