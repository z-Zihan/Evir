import { create } from "zustand";
import { MemoryRepository } from "../../core/memory/memory-repository";
import {
  isMemoryEnabled,
  setMemoryEnabled as persistMemoryEnabled,
} from "../../core/memory/memory-preferences";
import type { CreateMemoryInput, MemoryRecord, UpdateMemoryInput } from "../../core/memory/types";
import { getStructuredStorage } from "../../runtime/structured-storage";

export type { MemoryRecord } from "../../core/memory/types";

interface MemoryState {
  memories: MemoryRecord[];
  enabled: boolean;
  loading: boolean;
  error: string | null;
  loadMemories: () => Promise<void>;
  addMemory: (memory: CreateMemoryInput) => Promise<string>;
  updateMemory: (id: string, input: UpdateMemoryInput) => Promise<void>;
  deleteMemory: (id: string) => Promise<void>;
  togglePin: (id: string) => Promise<void>;
  toggleEnabled: (id: string) => Promise<void>;
  setMemoryEnabled: (enabled: boolean) => Promise<void>;
  clearMemories: () => Promise<void>;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function repository(): MemoryRepository {
  return new MemoryRepository(getStructuredStorage());
}

export const useMemoryStore = create<MemoryState>((set, get) => ({
  memories: [],
  enabled: true,
  loading: false,
  error: null,

  loadMemories: async () => {
    set({ loading: true, error: null });
    try {
      const storage = getStructuredStorage();
      const [memories, enabled] = await Promise.all([
        new MemoryRepository(storage).list(),
        isMemoryEnabled(storage),
      ]);
      set({ memories, enabled, loading: false });
    } catch (error) {
      set({ loading: false, error: messageOf(error) });
    }
  },

  addMemory: async (input) => {
    try {
      const memory = await repository().create(input);
      set(({ memories }) => ({
        memories: [memory, ...memories.filter(({ id }) => id !== memory.id)],
        error: null,
      }));
      return memory.id;
    } catch (error) {
      set({ error: messageOf(error) });
      throw error;
    }
  },

  updateMemory: async (id, input) => {
    try {
      const memory = await repository().update(id, input);
      set(({ memories }) => ({
        memories: memories.map((candidate) => (candidate.id === id ? memory : candidate)),
        error: null,
      }));
    } catch (error) {
      set({ error: messageOf(error) });
      throw error;
    }
  },

  deleteMemory: async (id) => {
    try {
      await repository().delete(id);
      set(({ memories }) => ({
        memories: memories.filter((memory) => memory.id !== id),
        error: null,
      }));
    } catch (error) {
      set({ error: messageOf(error) });
      throw error;
    }
  },

  togglePin: async (id) => {
    const memory = get().memories.find((candidate) => candidate.id === id);
    if (memory) await get().updateMemory(id, { pinned: !memory.pinned });
  },

  toggleEnabled: async (id) => {
    const memory = get().memories.find((candidate) => candidate.id === id);
    if (memory) await get().updateMemory(id, { enabled: !memory.enabled });
  },

  setMemoryEnabled: async (enabled) => {
    try {
      await persistMemoryEnabled(getStructuredStorage(), enabled);
      set({ enabled, error: null });
    } catch (error) {
      set({ error: messageOf(error) });
      throw error;
    }
  },

  clearMemories: async () => {
    try {
      await repository().clear();
      set({ memories: [], error: null });
    } catch (error) {
      set({ error: messageOf(error) });
      throw error;
    }
  },
}));
