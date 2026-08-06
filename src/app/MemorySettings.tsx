import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
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
    <section className="memory-settings">
      <h3>{t("memory.title")}</h3>

      <div className="memory-add-form">
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
          type="button"
          onClick={() => void handleAdd()}
          disabled={!newKey.trim() || !newContent.trim()}
        >
          {t("memory.add")}
        </button>
      </div>

      {memories.length === 0 ? (
        <p className="memory-empty">{t("memory.empty")}</p>
      ) : (
        <ul className="memory-list">
          {memories.map((m: MemoryRecord) => (
            <li key={m.id} className={`memory-item${m.pinned ? " pinned" : ""}`}>
              {editingId === m.id ? (
                <div className="memory-edit">
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
                    {m.pinned && <span className="pin-badge">📌</span>}
                    <p>{m.content}</p>
                  </div>
                  <div className="memory-actions">
                    <button type="button" onClick={() => void togglePin(m.id)}>
                      {m.pinned ? "📌" : "📍"}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setEditingId(m.id);
                        setEditContent(m.content);
                      }}
                    >
                      ✏️
                    </button>
                    <button type="button" onClick={() => void deleteMemory(m.id)}>
                      🗑️
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
