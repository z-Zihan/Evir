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
    <section className="flex flex-col gap-3">
      <h3>{t("memory.title")}</h3>

      <div className="flex flex-col gap-2 mb-4">
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
        <p className="text-muted text-sm">{t("memory.empty")}</p>
      ) : (
        <ul className="list-none p-0 m-0 flex flex-col gap-2">
          {memories.map((m: MemoryRecord) => (
            <li
              key={m.id}
              className={`flex justify-between items-start p-3 border border-border rounded-lg bg-surface${m.pinned ? " pinned" : ""}`}
            >
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
                    {m.pinned && <span className="text-xs ml-1">📌</span>}
                    <p>{m.content}</p>
                  </div>
                  <div className="flex gap-1">
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
