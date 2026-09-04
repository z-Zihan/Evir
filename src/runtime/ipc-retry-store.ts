import { create } from "zustand";

import type { IpcCorrelation } from "./ipc-correlation";

/**
 * Live view of in-flight read-invoke retries caused by the macOS ipc:// scheme
 * stall (see desktop-storage-adapter.ts). The chat streaming status subscribes
 * to replace a stuck "responding…" hint with an honest low-noise retry state;
 * entries are keyed by toolCallId when known, else by command.
 */
export interface IpcRetryInfo extends IpcCorrelation {
  command: string;
  attempt: number;
  maxAttempts: number;
}

interface IpcRetryState {
  retries: Record<string, IpcRetryInfo>;
  beginRetry: (key: string, info: IpcRetryInfo) => void;
  endRetry: (key: string) => void;
}

export const useIpcRetryStore = create<IpcRetryState>((set) => ({
  retries: {},
  beginRetry: (key, info) => set((state) => ({ retries: { ...state.retries, [key]: info } })),
  endRetry: (key) =>
    set((state) => {
      if (!(key in state.retries)) return state;
      const retries = { ...state.retries };
      delete retries[key];
      return { retries };
    }),
}));

/** Imperative seam for non-React callers (the storage adapter). */
export const ipcRetryStore = {
  begin: (key: string, info: IpcRetryInfo): void => {
    useIpcRetryStore.getState().beginRetry(key, info);
  },
  end: (key: string): void => {
    useIpcRetryStore.getState().endRetry(key);
  },
};
