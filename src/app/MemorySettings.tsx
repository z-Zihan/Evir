import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Eye, EyeOff, Pencil, Pin, PinOff, Trash2 } from "lucide-react";
import { Button, cn, Input, Switch, Textarea, Tip } from "../components/ui";
import { EmptyState, InlineError, LoadingState } from "../components/feedback";
import {
  SettingsGroup,
  SettingsPage,
  SettingsPageIntro,
  SettingsRow,
} from "../components/settings";
import { useMemoryStore, type MemoryRecord } from "../features/memory/memory-store";
import { useConfirmationDialog } from "./useConfirmationDialog";

type MemoryScopeChoice = "global" | "workspace" | "conversation";
type MemoryExpiryChoice = "never" | "7" | "30" | "90";

interface MemorySettingsProps {
  conversationId: string | null;
  workspacePath: string | null;
}

export function MemorySettings({ conversationId, workspacePath }: MemorySettingsProps) {
  const { t, i18n } = useTranslation();
  const {
    memories,
    enabled,
    loading,
    error,
    loadMemories,
    addMemory,
    updateMemory,
    deleteMemory,
    togglePin,
    toggleEnabled,
    setMemoryEnabled,
    clearMemories,
  } = useMemoryStore();
  const [newKey, setNewKey] = useState("");
  const [newContent, setNewContent] = useState("");
  const [scopeChoice, setScopeChoice] = useState<MemoryScopeChoice>("global");
  const [expiryChoice, setExpiryChoice] = useState<MemoryExpiryChoice>("never");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");
  const { requestConfirmation, confirmationDialog } = useConfirmationDialog();

  useEffect(() => {
    void loadMemories();
  }, [loadMemories]);

  useEffect(() => {
    if (scopeChoice === "workspace" && !workspacePath) setScopeChoice("global");
    if (scopeChoice === "conversation" && !conversationId) setScopeChoice("global");
  }, [conversationId, scopeChoice, workspacePath]);

  const handleAdd = async () => {
    if (!newKey.trim() || !newContent.trim()) return;
    const scope =
      scopeChoice === "workspace"
        ? workspacePath
        : scopeChoice === "conversation"
          ? conversationId
          : "global";
    if (!scope) return;
    await addMemory({
      type:
        scopeChoice === "workspace"
          ? "workspace"
          : scopeChoice === "conversation"
            ? "conversation"
            : "long-term",
      scope,
      key: newKey.trim(),
      content: newContent.trim(),
      ...(expiryChoice === "never"
        ? {}
        : { expiresAt: Date.now() + Number(expiryChoice) * 86_400_000 }),
    });
    setNewKey("");
    setNewContent("");
  };

  const handleSaveEdit = async () => {
    if (!editingId || !editContent.trim()) return;
    await updateMemory(editingId, { content: editContent.trim() });
    setEditingId(null);
    setEditContent("");
  };

  const scopeLabel = (memory: MemoryRecord): string => {
    if (memory.scope === "global") return t("memory.scopeGlobal");
    if (memory.type === "workspace") return t("memory.scopeWorkspace");
    return t("memory.scopeConversation");
  };

  return (
    <SettingsPage>
      <SettingsPageIntro
        eyebrow={t("settingsDescriptions.localContext")}
        description={t("settingsDescriptions.memory")}
      />

      <SettingsGroup>
        <SettingsRow
          label={t("memory.recallTitle")}
          description={t("memory.recallDescription")}
          control={
            <label className="flex cursor-pointer items-center gap-2 text-[11.5px] whitespace-nowrap text-muted">
              <Switch
                checked={enabled}
                onCheckedChange={(checked) => {
                  void setMemoryEnabled(checked).catch(() => undefined);
                }}
                aria-label={enabled ? t("memory.enabled") : t("memory.disabled")}
              />
              <span>{enabled ? t("memory.enabled") : t("memory.disabled")}</span>
            </label>
          }
        />
      </SettingsGroup>

      <SettingsGroup>
        {/* Native select keeps platform/IME consistency in forms; styled with
            the same control tokens as SelectTrigger. */}
        <SettingsRow
          label={t("memory.scope")}
          htmlFor="memory-new-scope"
          control={
            <select
              id="memory-new-scope"
              className="form-select h-8 w-full rounded-lg border border-border bg-surface px-2.5 text-[12.5px] focus-visible:border-primary focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus sm:w-48"
              value={scopeChoice}
              onChange={(event) => setScopeChoice(event.target.value as MemoryScopeChoice)}
              aria-label={t("memory.scope")}
            >
              <option value="global">{t("memory.scopeGlobal")}</option>
              <option value="workspace" disabled={!workspacePath}>
                {t("memory.scopeWorkspace")}
              </option>
              <option value="conversation" disabled={!conversationId}>
                {t("memory.scopeConversation")}
              </option>
            </select>
          }
        />
        <SettingsRow
          label={t("memory.expiry")}
          htmlFor="memory-new-expiry"
          control={
            <select
              id="memory-new-expiry"
              className="form-select h-8 w-full rounded-lg border border-border bg-surface px-2.5 text-[12.5px] focus-visible:border-primary focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus sm:w-48"
              value={expiryChoice}
              onChange={(event) => setExpiryChoice(event.target.value as MemoryExpiryChoice)}
              aria-label={t("memory.expiry")}
            >
              <option value="never">{t("memory.expiryNever")}</option>
              <option value="7">{t("memory.expiryDays", { count: 7 })}</option>
              <option value="30">{t("memory.expiryDays", { count: 30 })}</option>
              <option value="90">{t("memory.expiryDays", { count: 90 })}</option>
            </select>
          }
        />
        <SettingsRow
          label={t("memory.key")}
          htmlFor="memory-new-key"
          control={
            <Input
              id="memory-new-key"
              className="sm:w-56"
              placeholder={t("memory.keyPlaceholder")}
              value={newKey}
              maxLength={80}
              onChange={(event) => setNewKey(event.target.value)}
            />
          }
        />
        <div className="flex flex-col gap-1.5 px-4 py-3.5">
          <label
            htmlFor="memory-new-content"
            className="block text-[12.5px] font-medium text-foreground"
          >
            {t("memory.content")}
          </label>
          <Textarea
            id="memory-new-content"
            placeholder={t("memory.contentPlaceholder")}
            value={newContent}
            maxLength={4000}
            onChange={(event) => setNewContent(event.target.value)}
            rows={2}
          />
        </div>
        <div className="flex justify-end px-4 py-3">
          <Button
            variant="primary"
            onClick={() => void handleAdd().catch(() => undefined)}
            disabled={!newKey.trim() || !newContent.trim()}
          >
            {t("memory.add")}
          </Button>
        </div>
      </SettingsGroup>

      {error && (
        <InlineError
          message={
            <>
              {t("memory.error")}: {error}
            </>
          }
        />
      )}
      {loading ? (
        <LoadingState label={t("memory.loading")} />
      ) : memories.length === 0 ? (
        <EmptyState
          icon={<Pin size={20} />}
          title={t("memory.empty")}
          description={t("settingsDescriptions.memoryEmpty")}
        />
      ) : (
        <>
          <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface-subtle">
            {memories.map((memory) => (
              <li
                key={memory.id}
                className={cn(
                  "flex items-start justify-between gap-3 px-4 py-3.5",
                  memory.pinned && "border-l-2 border-l-primary",
                )}
              >
                {editingId === memory.id ? (
                  <div className="flex w-full flex-col gap-1.5">
                    <Textarea
                      aria-label={t("memory.content")}
                      value={editContent}
                      maxLength={4000}
                      onChange={(event) => setEditContent(event.target.value)}
                      rows={2}
                    />
                    <div className="flex items-center gap-1.5">
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => void handleSaveEdit().catch(() => undefined)}
                        disabled={!editContent.trim()}
                      >
                        {t("memory.save")}
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setEditingId(null)}>
                        {t("memory.cancel")}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="min-w-0">
                      <strong className="text-[12.5px] text-foreground">{memory.key}</strong>
                      {memory.pinned && (
                        <Pin size={12} aria-hidden="true" className="ml-1 inline text-primary" />
                      )}
                      <p className="mt-1 text-[11.5px] leading-relaxed text-muted">
                        {memory.content}
                      </p>
                      <span className="mt-1 block text-[10.5px] text-muted">
                        {scopeLabel(memory)} · {t(`memory.source.${memory.source.kind}`)}
                        {memory.expiresAt
                          ? ` · ${t("memory.expires", { date: new Intl.DateTimeFormat(i18n.language).format(memory.expiresAt) })}`
                          : ""}
                      </span>
                    </div>
                    <div className="flex shrink-0 items-center gap-0.5">
                      <Tip content={memory.enabled ? t("memory.disable") : t("memory.enable")}>
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          onClick={() => void toggleEnabled(memory.id).catch(() => undefined)}
                          aria-label={memory.enabled ? t("memory.disable") : t("memory.enable")}
                          aria-pressed={memory.enabled}
                        >
                          {memory.enabled ? <Eye size={14} /> : <EyeOff size={14} />}
                        </Button>
                      </Tip>
                      <Tip content={memory.pinned ? t("memory.unpin") : t("memory.pin")}>
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          onClick={() => void togglePin(memory.id).catch(() => undefined)}
                          aria-label={memory.pinned ? t("memory.unpin") : t("memory.pin")}
                          aria-pressed={memory.pinned}
                        >
                          {memory.pinned ? <PinOff size={14} /> : <Pin size={14} />}
                        </Button>
                      </Tip>
                      <Tip content={t("memory.edit")}>
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          aria-label={t("memory.edit")}
                          onClick={() => {
                            setEditingId(memory.id);
                            setEditContent(memory.content);
                          }}
                        >
                          <Pencil size={14} />
                        </Button>
                      </Tip>
                      <Tip content={t("memory.delete")}>
                        <Button
                          variant="ghost-destructive"
                          size="icon-xs"
                          onClick={() =>
                            requestConfirmation(
                              {
                                title: t("confirmation.deleteTitle"),
                                description: t("confirmation.deleteDescription", {
                                  item: memory.key,
                                }),
                                confirmLabel: t("memory.delete"),
                              },
                              () => deleteMemory(memory.id),
                            )
                          }
                          aria-label={t("memory.delete")}
                        >
                          <Trash2 size={14} />
                        </Button>
                      </Tip>
                    </div>
                  </>
                )}
              </li>
            ))}
          </ul>
          <div className="flex">
            <Button
              variant="destructive"
              size="sm"
              onClick={() =>
                requestConfirmation(
                  {
                    title: t("confirmation.clearTitle"),
                    description: t("confirmation.clearDescription", { item: t("memory.allData") }),
                    confirmLabel: t("memory.clearAll"),
                  },
                  clearMemories,
                )
              }
            >
              {t("memory.clearAll")}
            </Button>
          </div>
        </>
      )}
      {confirmationDialog}
    </SettingsPage>
  );
}
