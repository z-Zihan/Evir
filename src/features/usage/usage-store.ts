import { create } from "zustand";
// NOTE: Uses Dexie directly for indexed queries; StoragePort covers basic CRUD
import type { UsageRecord } from "../../core/storage/db";
import { getStructuredStorage } from "../../runtime/structured-storage";

interface UsageState {
  records: UsageRecord[];
  loadRecords: () => Promise<void>;
  addRecord: (record: UsageRecord) => Promise<void>;
  getTotalTokens: () => number;
}

export const useUsageStore = create<UsageState>((set, get) => ({
  records: [],
  loadRecords: async () => {
    const records = await getStructuredStorage().readAll<UsageRecord>("usage_records");
    records.sort((a, b) => b.createdAt - a.createdAt);
    set({ records });
  },
  addRecord: async (record) => {
    await getStructuredStorage().write("usage_records", record.id, record);
    set(({ records }) => ({ records: [record, ...records.filter(({ id }) => id !== record.id)] }));
  },
  getTotalTokens: () =>
    get().records.reduce((total, record) => total + (record.totalTokens ?? 0), 0),
}));
