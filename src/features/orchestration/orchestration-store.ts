import { create } from "zustand";
import type { OrchestrationSnapshot } from "../../core/orchestration/types";

interface OrchestrationState {
  current: OrchestrationSnapshot | null;
  preparing: { conversationId: string; objective: string } | null;
  setCurrent(snapshot: OrchestrationSnapshot | null): void;
  setPreparing(value: { conversationId: string; objective: string } | null): void;
}

export const useOrchestrationStore = create<OrchestrationState>((set) => ({
  current: null,
  preparing: null,
  setCurrent: (current) => set({ current }),
  setPreparing: (preparing) => set({ preparing }),
}));
