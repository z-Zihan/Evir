import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ArrowUp, FileText, Globe, Paperclip, Sparkles, Square, X } from "lucide-react";
import { Button, Tip } from "../../components/ui";
import {
  PromptInput,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
} from "../../components/ai";
import { useChatStore, type ChatState } from "../../features/chat/chat-store";
import { useShallow } from "zustand/react/shallow";
import { useWorkspacePanelStore } from "../../features/workspace/workspace-panel-store";
import { useSkillStore } from "../../features/skills/skill-store";
import { workspaceResourceTitle } from "../../features/workspace/resource-model";
import { formatAnnotationDraft, parseAnnotationPayload } from "../../features/workspace/annotation";
import { subscribePanelAnnotations } from "../../features/workspace/browser-panel-service";
import type { ProjectRecord } from "../../core/storage/db";
import { ModeSwitcher } from "../ModeSwitcher";
import { PermissionSwitcher } from "../PermissionSwitcher";
import { SkillPicker } from "../SkillPicker";
import { SlashPalette, type SlashCommandId, type SlashPaletteHandle } from "../SlashPalette";
import { useDragDrop } from "../use-drag-drop";

const composerStoresSelector = (state: ChatState) => ({
  pendingAttachments: state.pendingAttachments,
  addAttachment: state.addAttachment,
  removeAttachment: state.removeAttachment,
  selectedSkillIds: state.selectedSkillIds,
  toggleSelectedSkill: state.toggleSelectedSkill,
});

export interface ChatComposerProps {
  input: string;
  onInputChange: (value: string) => void;
  onSendMessage: () => void;
  /** Stop the active stream (the submit button morphs into Stop). */
  onStop: () => void;
  /** Streaming in the conversation this composer authors into. */
  streaming: boolean;
  /** Model-aware effective mode (web target downgrades to ask). */
  effectiveMode: ChatState["mode"];
  mode: ChatState["mode"];
  onModeChange: (mode: ChatState["mode"]) => void;
  projectScoped: boolean;
  toolCalling: boolean;
  isWebTarget: boolean;
  conversationProject: ProjectRecord | undefined;
  onOpenSettings: () => void;
  /** The slash /model command opens the in-header model picker. */
  onModelSwitchCommand: () => void;
  /** Chat-level error strip rendered at the top of the composer dock. */
  errorBanner?: ReactNode;
}

/**
 * The chat composer dock (AI Elements PromptInput composition): attachments,
 * skill chips, workspace context chips, slash palette, footer controls and
 * submit/stop. Owns its local UI state (drag-over, slash palette, file input)
 * and reads its domain state straight from the stores.
 */
export function ChatComposer({
  input,
  onInputChange,
  onSendMessage,
  onStop,
  streaming,
  effectiveMode,
  mode,
  onModeChange,
  projectScoped,
  toolCalling,
  isWebTarget,
  conversationProject,
  onOpenSettings,
  onModelSwitchCommand,
  errorBanner,
}: ChatComposerProps) {
  const { t, i18n } = useTranslation();
  const {
    pendingAttachments,
    addAttachment,
    removeAttachment,
    selectedSkillIds,
    toggleSelectedSkill,
  } = useChatStore(useShallow(composerStoresSelector));
  const installedSkills = useSkillStore((state) => state.skills);
  const contextResource = useWorkspacePanelStore((state) =>
    state.open && state.activeTab === "preview" ? state.activeResource : null,
  );
  // Only surface the browser chip while the browser tab is actually on
  // screen; the URL otherwise lingers above the composer after closing.
  const contextBrowserUrl = useWorkspacePanelStore((state) =>
    state.open && state.activeTab === "browser" ? state.browserContextUrl : null,
  );

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const slashPaletteRef = useRef<SlashPaletteHandle>(null);
  const [slashDismissed, setSlashDismissed] = useState(false);
  const inputRef = useRef(input);
  inputRef.current = input;
  const slashOpen = input.startsWith("/") && !slashDismissed && !streaming;

  useEffect(() => {
    if (!input.startsWith("/")) setSlashDismissed(false);
  }, [input]);

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

  const handleSlashCommand = (id: SlashCommandId) => {
    if (id === "plan") onModeChange("plan");
    if (id === "goal") onModeChange("goal");
    if (id === "agent") onModeChange("agent");
    if (id === "model") onModelSwitchCommand();
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

  useEffect(() => {
    const focusComposer = () => textareaRef.current?.focus();
    window.addEventListener("evir:focus-composer", focusComposer);
    return () => window.removeEventListener("evir:focus-composer", focusComposer);
  }, []);

  return (
    <footer className="composer-wrap mx-auto w-full min-w-0 max-w-[760px] shrink-0 px-0 pb-3 pt-1.5 max-[860px]:px-4">
      {errorBanner}
      <PromptInput
        className={`composer ${dragOver ? "drag-over border-primary/60 shadow-sm" : ""}`}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onSubmit={(event) => {
          event.preventDefault();
          onSendMessage();
        }}
      >
        {(pendingAttachments.length > 0 || selectedSkillIds.size > 0) && (
          <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 px-3 pt-2.5">
            {pendingAttachments.map((att) =>
              att.type === "image" ? (
                <span
                  key={att.id}
                  className="inline-flex max-w-[220px] items-center gap-1.5 rounded-md border border-border bg-surface-hover py-1 pr-1 pl-2 text-[11.5px] text-foreground"
                >
                  <img
                    src={att.data}
                    alt={att.fileName}
                    className="size-6 rounded-sm border border-border object-cover"
                  />
                  <span className="truncate">{att.fileName}</span>
                  <RemoveChipButton
                    label={t("chat.removeAttachment")}
                    onRemove={() => removeAttachment(att.id)}
                  />
                </span>
              ) : (
                <span
                  key={att.id}
                  className="inline-flex max-w-[220px] items-center gap-1.5 rounded-md border border-border bg-surface-hover py-1 pr-1 pl-2 text-[11.5px] text-foreground"
                >
                  <span className="truncate">{att.fileName}</span>
                  <RemoveChipButton
                    label={t("chat.removeAttachment")}
                    onRemove={() => removeAttachment(att.id)}
                  />
                </span>
              ),
            )}
            {installedSkills
              .filter((skill) => selectedSkillIds.has(skill.manifest.id))
              .map((skill) => {
                const locale = i18n.resolvedLanguage === "zh-CN" ? "zh-CN" : "en";
                const name = skill.manifest.localizations?.[locale]?.name ?? skill.manifest.name;
                return (
                  <span
                    key={skill.manifest.id}
                    className="inline-flex max-w-[220px] items-center gap-1.5 rounded-md border border-primary/30 bg-primary/[0.06] py-1 pr-1 pl-2 text-[11.5px] text-foreground"
                  >
                    <Sparkles size={11} aria-hidden="true" className="shrink-0 text-primary" />
                    <span className="truncate">{name}</span>
                    <RemoveChipButton
                      label={t("skill.removeSelected", { name })}
                      onRemove={() => toggleSelectedSkill(skill.manifest.id)}
                    />
                  </span>
                );
              })}
          </div>
        )}
        {slashOpen && (
          <SlashPalette
            ref={slashPaletteRef}
            query={input.slice(1)}
            projectScoped={projectScoped && !isWebTarget}
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
          disabled={streaming}
          className="max-h-[200px] min-h-[52px] px-3.5 py-3 text-[13.5px] leading-relaxed text-foreground placeholder:text-muted disabled:opacity-60"
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
                disabled={streaming}
                aria-label={t("chat.attachFile")}
              >
                <Paperclip size={15} />
              </Button>
            </Tip>
            <SkillPicker mode={isWebTarget ? "ask" : effectiveMode} disabled={streaming} />
          </PromptInputTools>
          <div className="flex min-w-0 items-center gap-1.5">
            {projectScoped && !isWebTarget && conversationProject && (
              <PermissionSwitcher project={conversationProject} />
            )}
            <ModeSwitcher
              mode={mode}
              onModeChange={onModeChange}
              projectScoped={projectScoped}
              toolCalling={toolCalling}
              onConfigureModel={onOpenSettings}
            />
            <span className="composer-info">
              {input.length > 0 && (
                <span className="char-count text-[10.5px] text-muted">{input.length}</span>
              )}
            </span>
            {streaming ? (
              <PromptInputSubmit
                status="streaming"
                onStop={onStop}
                type="button"
                aria-label={t("chat.stop")}
                onClick={(event) => {
                  // The send button morphs into Stop after the first click. Ignore the
                  // second click of the same physical double-click so a rapid submit
                  // cannot immediately cancel the request it just started.
                  if (event.detail > 1) return;
                  onStop();
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
          </div>
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
      <p className="disclaimer px-1 pt-1.5 text-center text-[10.5px] text-muted">
        {t("chat.disclaimer")}
      </p>
    </footer>
  );
}

function RemoveChipButton({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <Tip content={label}>
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label={label}
        onClick={onRemove}
        className="text-muted hover:text-foreground"
      >
        <X size={11} />
      </Button>
    </Tip>
  );
}
