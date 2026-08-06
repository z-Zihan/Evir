import { create } from "zustand";
import { db } from "../../core/storage/db";

export interface MemoryRecord {
  id: string;
  type: "conversation" | "workspace" | "long-term";
  scope: string; // conversationId or workspacePath or "global"
  key: string;
  content: string;
  createdAt: number;
  updatedAt: number;
  pinned: boolean;
}

interface MemoryState {
  memories: MemoryRecord[];
  loadMemories: (scope: string) => Promise<void>;
  addMemory: (
    memory: Omit<MemoryRecord, "id" | "createdAt" | "updatedAt" | "pinned">,
  ) => Promise<string>;
  updateMemory: (id: string, content: string) => Promise<void>;
  deleteMemory: (id: string) => Promise<void>;
  togglePin: (id: string) => Promise<void>;
  getScoped: (scope: string) => MemoryRecord[];
  buildMemoryContext: (scope: string) => string;
}

export const useMemoryStore = create<MemoryState>((set, get) => ({
  memories: [],

  loadMemories: async (scope) => {
    // Memory is stored in settings table as JSON
    const record = await db.settings.get(`memories:${scope}`);
    const memories: MemoryRecord[] = Array.isArray(record?.value)
      ? (record.value as MemoryRecord[])
      : [];
    set({ memories });
  },

  addMemory: async (memory) => {
    const id = `mem-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const now = Date.now();
    const record: MemoryRecord = {
      ...memory,
      id,
      createdAt: now,
      updatedAt: now,
      pinned: false,
    };
    const current = get().memories;
    const updated = [...current, record];
    await db.settings.put({ name: `memories:${record.scope}`, value: updated });
    set({ memories: updated });
    return id;
  },

  updateMemory: async (id, content) => {
    const updated = get().memories.map((m) =>
      m.id === id ? { ...m, content, updatedAt: Date.now() } : m,
    );
    const memory = updated.find((m) => m.id === id);
    if (memory) {
      await db.settings.put({ name: `memories:${memory.scope}`, value: updated });
    }
    set({ memories: updated });
  },

  deleteMemory: async (id) => {
    const memory = get().memories.find((m) => m.id === id);
    const updated = get().memories.filter((m) => m.id !== id);
    if (memory) {
      await db.settings.put({ name: `memories:${memory.scope}`, value: updated });
    }
    set({ memories: updated });
  },

  togglePin: async (id) => {
    const updated = get().memories.map((m) =>
      m.id === id ? { ...m, pinned: !m.pinned, updatedAt: Date.now() } : m,
    );
    const memory = updated.find((m) => m.id === id);
    if (memory) {
      await db.settings.put({ name: `memories:${memory.scope}`, value: updated });
    }
    set({ memories: updated });
  },

  getScoped: (scope) => {
    return get().memories.filter((m) => m.scope === scope || m.scope === "global");
  },

  buildMemoryContext: (scope) => {
    const scoped = get().getScoped(scope);
    if (scoped.length === 0) return "";
    const pinned = scoped.filter((m) => m.pinned);
    const normal = scoped.filter((m) => !m.pinned);
    const parts: string[] = [];
    if (pinned.length > 0) {
      parts.push("Pinned memories:");
      pinned.forEach((m) => parts.push(`- [${m.key}] ${m.content}`));
    }
    if (normal.length > 0) {
      parts.push("Memories:");
      normal.forEach((m) => parts.push(`- [${m.key}] ${m.content}`));
    }
    return parts.join("\n");
  },
}));
