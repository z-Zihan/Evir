import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pencil, Pin, PinOff, Trash2 } from "lucide-react";
import { useMemoryStore, type MemoryRecord } from "../features/memory/memory-store";

export function MemorySettings({ conversationId }: { conversationId: string | null }) {
  const { t } = useTranslation();
  const { memories, loadMemories, addMemory, updateMemory, deleteMemory, togglePin } =
    useMemoryStore();
  const [newKey, setNewKey] = useState("");
  const [newContent, setNewContent] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");

  useEffect(() => {
    void loadMemories(conversationId ?? "global");
  }, [conversationId, loadMemories]);

  const handleAdd = async () => {
    if (!newKey.trim() || !newContent.trim()) return;
    await addMemory({
      type: "conversation",
      scope: conversationId ?? "global",
      key: newKey.trim(),
      content: newContent.trim(),
    });
    setNewKey("");
    setNewContent("");
  };

  const handleSaveEdit = async () => {
    if (!editingId) return;
    await updateMemory(editingId, editContent);
    setEditingId(null);
    setEditContent("");
  };

  return (
    <section className="memory-settings settings-designed-page">
      <div className="settings-page-intro compact">
        <div>
          <span className="settings-page-eyebrow">{t("settingsDescriptions.localContext")}</span>
          <p>{t("settingsDescriptions.memory")}</p>
        </div>
      </div>

      <div className="memory-create-card">
        <input
          placeholder={t("memory.keyPlaceholder")}
          value={newKey}
          onChange={(e) => setNewKey(e.target.value)}
        />
        <textarea
          placeholder={t("memory.contentPlaceholder")}
          value={newContent}
          onChange={(e) => setNewContent(e.target.value)}
          rows={2}
        />
        <button
          className="primary-button"
          type="button"
          onClick={() => void handleAdd()}
          disabled={!newKey.trim() || !newContent.trim()}
        >
          {t("memory.add")}
        </button>
      </div>

      {memories.length === 0 ? (
        <div className="settings-empty-state">
          <Pin size={20} />
          <strong>{t("memory.empty")}</strong>
          <span>{t("settingsDescriptions.memoryEmpty")}</span>
        </div>
      ) : (
        <ul className="memory-list">
          {memories.map((m: MemoryRecord) => (
            <li key={m.id} className={`memory-item${m.pinned ? " pinned" : ""}`}>
              {editingId === m.id ? (
                <div className="w-full flex flex-col gap-1">
                  <textarea
                    value={editContent}
                    onChange={(e) => setEditContent(e.target.value)}
                    rows={2}
                  />
                  <button type="button" onClick={() => void handleSaveEdit()}>
                    {t("memory.save")}
                  </button>
                  <button type="button" onClick={() => setEditingId(null)}>
                    {t("memory.cancel")}
                  </button>
                </div>
              ) : (
                <>
                  <div className="memory-content">
                    <strong>{m.key}</strong>
                    {m.pinned && <Pin size={12} className="memory-pin-indicator" />}
                    <p>{m.content}</p>
                  </div>
                  <div className="memory-item-actions">
                    <button
                      type="button"
                      onClick={() => void togglePin(m.id)}
                      aria-label={m.pinned ? t("memory.unpin") : t("memory.pin")}
                    >
                      {m.pinned ? <PinOff size={14} /> : <Pin size={14} />}
                    </button>
                    <button
                      type="button"
                      aria-label={t("memory.edit")}
                      onClick={() => {
                        setEditingId(m.id);
                        setEditContent(m.content);
                      }}
                    >
                      <Pencil size={14} />
                    </button>
                    <button
                      type="button"
                      onClick={() => void deleteMemory(m.id)}
                      aria-label={t("memory.delete")}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
