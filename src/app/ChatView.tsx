import { memo, useCallback, useEffect, useRef, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { Download, Paperclip, Square, X } from "lucide-react";
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

interface ChatViewProps {
  input: string;
  onInputChange: (input: string) => void;
  onSendMessage: () => void;
  onOpenSettings: () => void;
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

export function ChatView({ input, onInputChange, onSendMessage, onOpenSettings }: ChatViewProps) {
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

  if (!provider) {
    return (
      <main className="min-w-0 flex-1 grid grid-rows-[auto_1fr_auto] bg-background">
        <header className="flex items-center justify-between px-6 py-3 border-b border-border bg-surface">
          <div className="flex items-center gap-3 min-w-0">
            <h1 className="text-sm font-semibold truncate">
              {conversations.find((c) => c.id === currentConversationId)?.title ||
                t("chat.newChat")}
            </h1>
          </div>
          <div className="flex items-center gap-2">
            <ModeSwitcher mode={mode} onModeChange={setMode} />
            <ModelSwitcher
              onSwitch={(p: ProviderRecord) => {
                void (async () => {
                  await switchProvider(p.id);
                  await updateConversationProvider(p.id, p.modelId);
                })();
              }}
            />
          </div>
        </header>
        <section className="grid place-content-center w-[min(720px,calc(100%-40px))] m-auto text-center py-12 px-4">
          <div className="empty-copy">
            <h2>{t("chat.noProvider")}</h2>
            <button
              className="flex items-center justify-center gap-2 min-h-[38px] rounded-lg font-semibold border border-border bg-surface hover:bg-surface-hover transition"
              type="button"
              onClick={onOpenSettings}
            >
              {t("chat.addProviderFirst")}
            </button>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="min-w-0 flex-1 grid grid-rows-[auto_1fr_auto] bg-background">
      <div className="overflow-y-auto p-6 px-4" ref={scrollRef}>
        {messages.length === 0 && !isStreaming ? (
          <ChatEmptyState onSendMessage={(content) => void sendMessage(content)} />
        ) : (
          <div className="max-w-[780px] mx-auto flex flex-col gap-5">
            <MessageList
              messages={messages}
              disabled={isStreaming}
              onEdit={editMessage}
              onRegenerate={regenerate}
              onBranch={handleBranch}
            />
            {isStreaming && (
              <div className="max-w-[780px] mx-auto w-full message-assistant">
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
      {error && (
        <div className="max-w-[780px] mx-auto mb-3 p-3 bg-danger/8 border border-danger/20 rounded-lg text-danger text-sm">
          {displayError(error)}
        </div>
      )}
      <footer className="w-[min(820px,calc(100%-40px))] mx-auto py-3 pb-4">
        <div
          className={`border border-border rounded-2xl bg-surface shadow-md focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/12 transition${dragOver ? " border-primary bg-primary/4" : ""}`}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
        >
          {pendingAttachments.length > 0 && (
            <div className="flex flex-wrap gap-2 px-4 pt-2">
              {pendingAttachments.map((att) =>
                att.type === "image" ? (
                  <div
                    key={att.id}
                    className="flex items-center gap-1 px-2 py-1 bg-surface-hover border border-border rounded-lg text-xs"
                  >
                    <img
                      src={att.data}
                      alt={att.fileName}
                      className="w-8 h-8 rounded object-cover"
                    />
                    <button
                      type="button"
                      onClick={() => removeAttachment(att.id)}
                      aria-label={t("chat.removeAttachment")}
                    >
                      <X size={12} />
                    </button>
                  </div>
                ) : (
                  <div
                    key={att.id}
                    className="flex items-center gap-1 px-2 py-1 bg-surface-hover border border-border rounded-lg text-xs"
                  >
                    <span className="max-w-[140px] truncate">{att.fileName}</span>
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
          <div className="flex justify-between items-center px-3 pb-3 text-muted text-xs">
            <span>
              <button
                type="button"
                className="grid place-items-center w-8 h-8 rounded-lg text-muted hover:bg-surface-hover hover:text-foreground transition"
                onClick={() => fileInputRef.current?.click()}
                disabled={isStreaming}
                aria-label={t("chat.attachFile")}
              >
                <Paperclip size={16} />
              </button>

              <button
                type="button"
                className="grid place-items-center w-8 h-8 rounded-lg text-muted hover:bg-surface-hover hover:text-foreground transition"
                onClick={() => void handleExportMarkdown(currentConversationId ?? "")}
                disabled={isStreaming || !currentConversationId}
                aria-label={t("settings.exportMarkdown")}
                title={t("settings.exportMarkdown")}
              >
                <Download size={16} />
              </button>
            </span>
            <div className="flex items-center gap-2 ml-auto">
              {getRuntime().target === "desktop" && <WorkspaceSelector />}
              <span className="text-xs text-muted opacity-60 flex gap-2 items-center">
                {input.length > 0 && <span className="opacity-50">{input.length}</span>}
                {tokenCount > 0 && t("chat.tokenCount", { count: tokenCount })}
              </span>
            </div>
            {isStreaming ? (
              <button
                type="button"
                className="bg-danger px-3 py-1.5 rounded-lg text-primary-fg text-sm font-medium"
                onClick={stopGeneration}
              >
                <Square size={14} />
                {t("chat.stop")}
              </button>
            ) : (
              <button
                type="button"
                className="bg-primary px-3 py-1.5 rounded-lg text-primary-fg text-sm font-medium disabled:opacity-50"
                disabled={!input.trim() && pendingAttachments.length === 0}
                onClick={onSendMessage}
              >
                {t("chat.send")}
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
        <p className="text-center text-xs text-muted py-1 pb-2 opacity-60">
          {t("chat.disclaimer")}
        </p>
      </footer>
    </main>
  );
}
