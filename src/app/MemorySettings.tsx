import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Eye, EyeOff, Pencil, Pin, PinOff, Trash2 } from "lucide-react";
import { Button, Input, Switch, Textarea, Tip } from "../components/ui";
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
    <section className="memory-settings settings-designed-page">
      <div className="settings-page-intro compact">
        <div>
          <span className="settings-page-eyebrow">{t("settingsDescriptions.localContext")}</span>
          <p>{t("settingsDescriptions.memory")}</p>
        </div>
      </div>

      <div className="memory-control-bar">
        <div>
          <strong>{t("memory.recallTitle")}</strong>
          <span>{t("memory.recallDescription")}</span>
        </div>
        <label className="memory-master-toggle">
          <Switch
            checked={enabled}
            onCheckedChange={(checked) => {
              void setMemoryEnabled(checked).catch(() => undefined);
            }}
            aria-label={enabled ? t("memory.enabled") : t("memory.disabled")}
          />
          <span>{enabled ? t("memory.enabled") : t("memory.disabled")}</span>
        </label>
      </div>

      <div className="memory-create-card">
        <label>
          <span>{t("memory.scope")}</span>
          {/* Native select keeps platform/IME consistency in forms; styled with
              the same control tokens as SelectTrigger. */}
          <select
            className="form-select h-8 w-full rounded-lg border border-border bg-surface px-2.5 text-[12.5px] focus-visible:border-primary focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus"
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
        </label>
        <label>
          <span>{t("memory.expiry")}</span>
          <select
            className="form-select h-8 w-full rounded-lg border border-border bg-surface px-2.5 text-[12.5px] focus-visible:border-primary focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus"
            value={expiryChoice}
            onChange={(event) => setExpiryChoice(event.target.value as MemoryExpiryChoice)}
            aria-label={t("memory.expiry")}
          >
            <option value="never">{t("memory.expiryNever")}</option>
            <option value="7">{t("memory.expiryDays", { count: 7 })}</option>
            <option value="30">{t("memory.expiryDays", { count: 30 })}</option>
            <option value="90">{t("memory.expiryDays", { count: 90 })}</option>
          </select>
        </label>
        <label>
          <span>{t("memory.key")}</span>
          <Input
            placeholder={t("memory.keyPlaceholder")}
            value={newKey}
            maxLength={80}
            onChange={(event) => setNewKey(event.target.value)}
          />
        </label>
        <label>
          <span>{t("memory.content")}</span>
          <Textarea
            placeholder={t("memory.contentPlaceholder")}
            value={newContent}
            maxLength={4000}
            onChange={(event) => setNewContent(event.target.value)}
            rows={2}
          />
        </label>
        <Button
          variant="primary"
          size="lg"
          onClick={() => void handleAdd().catch(() => undefined)}
          disabled={!newKey.trim() || !newContent.trim()}
        >
          {t("memory.add")}
        </Button>
      </div>

      {error && (
        <div className="form-message error" role="alert">
          {t("memory.error")}: {error}
        </div>
      )}
      {loading ? (
        <div className="settings-empty-state" role="status">
          <span>{t("memory.loading")}</span>
        </div>
      ) : memories.length === 0 ? (
        <div className="settings-empty-state">
          <Pin size={20} />
          <strong>{t("memory.empty")}</strong>
          <span>{t("settingsDescriptions.memoryEmpty")}</span>
        </div>
      ) : (
        <>
          <ul className="memory-list">
            {memories.map((memory) => (
              <li
                key={memory.id}
                className={`memory-item${memory.pinned ? " pinned" : ""}${memory.enabled ? "" : " disabled"}`}
              >
                {editingId === memory.id ? (
                  <div className="memory-edit-form">
                    <Textarea
                      aria-label={t("memory.content")}
                      value={editContent}
                      maxLength={4000}
                      onChange={(event) => setEditContent(event.target.value)}
                      rows={2}
                    />
                    <div>
                      <button
                        type="button"
                        onClick={() => void handleSaveEdit().catch(() => undefined)}
                        disabled={!editContent.trim()}
                      >
                        {t("memory.save")}
                      </button>
                      <button type="button" onClick={() => setEditingId(null)}>
                        {t("memory.cancel")}
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="memory-content">
                      <strong>{memory.key}</strong>
                      {memory.pinned && <Pin size={12} className="memory-pin-indicator" />}
                      <p>{memory.content}</p>
                      <span className="memory-meta">
                        {scopeLabel(memory)} · {t(`memory.source.${memory.source.kind}`)}
                        {memory.expiresAt
                          ? ` · ${t("memory.expires", { date: new Intl.DateTimeFormat(i18n.language).format(memory.expiresAt) })}`
                          : ""}
                      </span>
                    </div>
                    <div className="memory-item-actions">
                      <Tip content={memory.enabled ? t("memory.disable") : t("memory.enable")}>
                        <button
                          type="button"
                          onClick={() => void toggleEnabled(memory.id).catch(() => undefined)}
                          aria-label={memory.enabled ? t("memory.disable") : t("memory.enable")}
                          aria-pressed={memory.enabled}
                        >
                          {memory.enabled ? <Eye size={14} /> : <EyeOff size={14} />}
                        </button>
                      </Tip>
                      <Tip content={memory.pinned ? t("memory.unpin") : t("memory.pin")}>
                        <button
                          type="button"
                          onClick={() => void togglePin(memory.id).catch(() => undefined)}
                          aria-label={memory.pinned ? t("memory.unpin") : t("memory.pin")}
                          aria-pressed={memory.pinned}
                        >
                          {memory.pinned ? <PinOff size={14} /> : <Pin size={14} />}
                        </button>
                      </Tip>
                      <Tip content={t("memory.edit")}>
                        <button
                          type="button"
                          aria-label={t("memory.edit")}
                          onClick={() => {
                            setEditingId(memory.id);
                            setEditContent(memory.content);
                          }}
                        >
                          <Pencil size={14} />
                        </button>
                      </Tip>
                      <Tip content={t("memory.delete")}>
                        <button
                          type="button"
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
                        </button>
                      </Tip>
                    </div>
                  </>
                )}
              </li>
            ))}
          </ul>
          <Button
            variant="secondary"
            size="lg"
            className="danger memory-clear-button"
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
        </>
      )}
      {confirmationDialog}
    </section>
  );
}
