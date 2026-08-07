import { IndexedDBAdapter } from "../core/storage/indexed-db-adapter";
import type { StoragePort } from "../core/storage/storage-port";
import { getRuntime } from "./use-runtime";

const fallbackWebStorage = new IndexedDBAdapter();

export function getStructuredStorage(): StoragePort {
  return getRuntime().structuredStorage ?? fallbackWebStorage;
}
