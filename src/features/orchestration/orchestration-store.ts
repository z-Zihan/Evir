import { create } from "zustand";
import type { OrchestrationSnapshot } from "../../core/orchestration/types";

export interface TaskPreparationState {
  conversationId: string;
  objective: string;
  stage: "intake" | "planning";
  startedAt: number;
}

interface OrchestrationState {
  current: OrchestrationSnapshot | null;
  preparing: TaskPreparationState | null;
  setCurrent(snapshot: OrchestrationSnapshot | null): void;
  setPreparing(value: TaskPreparationState | null): void;
  setPreparationStage(conversationId: string, stage: TaskPreparationState["stage"]): void;
}

export const useOrchestrationStore = create<OrchestrationState>((set) => ({
  current: null,
  preparing: null,
  setCurrent: (current) => set({ current }),
  setPreparing: (preparing) => set({ preparing }),
  setPreparationStage: (conversationId, stage) =>
    set(({ preparing }) => ({
      preparing: preparing?.conversationId === conversationId ? { ...preparing, stage } : preparing,
    })),
}));
