import { memo, useCallback, useEffect, useRef, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowUp,
  Download,
  KeyRound,
  PanelLeft,
  Paperclip,
  Settings2,
  Square,
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
import { WorkspaceSelector } from "./WorkspaceSelector";
import { getRuntime } from "../runtime/use-runtime";
import { handleExportMarkdown } from "./export-helpers";
import { useConversationTokenCount } from "./use-token-count";
import { ModelSwitchCoordinatorImpl } from "../core/providers/model-switch-coordinator-impl";
import type { ModelSwitchRequest } from "../core/providers/model-switching";

const modelSwitchCoordinator = new ModelSwitchCoordinatorImpl();

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
  onEdit: (messageId: string, content: string) => Promise<void>;
  onRegenerate: () => Promise<void>;
  onBranch: (messageId: string) => void;
}

const MessageList = memo(function MessageList({
  messages,
  disabled,
  onEdit,
  onRegenerate,
  onBranch,
}: MessageListProps) {
  return (
    <>
      {messages.map((msg) => (
        <ChatMessage
          key={msg.id}
          message={msg}
          disabled={disabled}
          onEdit={onEdit}
          onRegenerate={onRegenerate}
          onBranch={onBranch}
        />
      ))}
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
    branchConversation,
    updateConversationProvider,
    currentConversationId,
    conversations,
  } = useChatStore();
  const { getDefaultProvider, switchProvider } = useProviderStore();

  const provider = getDefaultProvider();
  const conversationTitle =
    conversations.find((conversation) => conversation.id === currentConversationId)?.title ||
    t("chat.title");

  const tokenCount = useConversationTokenCount(currentConversationId);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, streamingContent]);

  const displayError = (value: string) => (i18n.exists(value) ? t(value) : value);

  const handleBranch = useCallback(
    (messageId: string) => void branchConversation(messageId),
    [branchConversation],
  );

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
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
            {provider ? provider.name : t("runtime.chatOnly")}
          </span>
        </div>
      </div>
      <div className="workspace-controls">
        <ModeSwitcher mode={mode} onModeChange={setMode} />
        <ModelSwitcher
          onSwitch={(nextProvider: ProviderRecord) => {
            void (async () => {
              try {
                if (!currentConversationId) {
                  await switchProvider(nextProvider.id);
                  await updateConversationProvider(nextProvider.id, nextProvider.modelId);
                  return;
                }
                const request: ModelSwitchRequest = {
                  conversationId: currentConversationId,
                  fromProviderId: provider?.id ?? "",
                  fromModelId: provider?.modelId ?? "",
                  toProviderId: nextProvider.id,
                  toModelId: nextProvider.modelId,
                  requestedAt: Date.now(),
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
                const result = await modelSwitchCoordinator.execute(request, assessment);
                if (result.status !== "switched") {
                  useChatStore.setState({
                    error: t("chat.modelSwitchBlocked", { reason: result.status }),
                  });
                  return;
                }
                await switchProvider(nextProvider.id);
                await updateConversationProvider(nextProvider.id, nextProvider.modelId);
              } catch {
                useChatStore.setState({ error: t("chat.modelSwitchFailed") });
              }
            })();
          }}
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
      <div className="messages-area" ref={scrollRef}>
        {messages.length === 0 && !isStreaming ? (
          <ChatEmptyState onSendMessage={(content) => void sendMessage(content)} />
        ) : (
          <div className="message-list">
            <MessageList
              messages={messages}
              disabled={isStreaming}
              onEdit={editMessage}
              onRegenerate={regenerate}
              onBranch={handleBranch}
            />
            {isStreaming && (
              <div className="message message-assistant">
                <div className="message-content">
                  {streamingContent ? (
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{streamingContent}</ReactMarkdown>
                  ) : (
                    <span className="text-muted text-lg tracking-widest animate-pulse">…</span>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
      {error && <div className="chat-error">{displayError(error)}</div>}
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
                    >
                      <X size={12} />
                    </button>
                  </div>
                ),
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
              >
                <Paperclip size={16} />
              </button>

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
              {getRuntime().target === "desktop" && <WorkspaceSelector />}
              <span className="composer-info">
                {input.length > 0 && <span className="char-count">{input.length}</span>}
                {tokenCount > 0 && t("chat.tokenCount", { count: tokenCount })}
              </span>
            </div>
            {isStreaming ? (
              <button type="button" className="send-button stop-button" onClick={stopGeneration}>
                <Square size={14} />
                {t("chat.stop")}
              </button>
            ) : (
              <button
                type="button"
                className="send-button"
                disabled={!input.trim() && pendingAttachments.length === 0}
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
    </main>
  );
}
