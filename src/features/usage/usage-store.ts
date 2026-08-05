import { create } from "zustand";
// NOTE: Uses Dexie directly for indexed queries; StoragePort covers basic CRUD
import { db, type UsageRecord } from "../../core/storage/db";

interface UsageState {
  records: UsageRecord[];
  loadRecords: () => Promise<void>;
  addRecord: (record: UsageRecord) => Promise<void>;
  getTotalTokens: () => number;
}

export const useUsageStore = create<UsageState>((set, get) => ({
  records: [],
  loadRecords: async () => {
    const records = await db.usage_records.orderBy("createdAt").reverse().toArray();
    set({ records });
  },
  addRecord: async (record) => {
    await db.usage_records.put(record);
    set(({ records }) => ({ records: [record, ...records.filter(({ id }) => id !== record.id)] }));
  },
  getTotalTokens: () =>
    get().records.reduce((total, record) => total + (record.totalTokens ?? 0), 0),
}));
