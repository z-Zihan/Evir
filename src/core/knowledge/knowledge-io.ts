/**
 * Knowledge IO port: the only way ingestion touches the outside world.
 * The desktop implementation wraps the structured-storage file adapter
 * (Rust fs boundary); tests inject an in-memory implementation.
 */
import { isIngestiblePath, MAX_FOLDER_FILES, type KnowledgeSourceType } from "./types";

export interface KnowledgeIoPort {
  /** Read a UTF-8 text file (desktop: Rust fs_read_file, workspace-validated). */
  readTextFile(path: string): Promise<string>;
  /** Read file bytes as base64 (PDF path). */
  readFileBase64(path: string): Promise<string>;
  /** Recursively list ingestible files under a folder, bounded. */
  listIngestibleFiles(folderPath: string): Promise<string[]>;
  /** Fetch a URL's body as text (web-url source, §66: explicit adds only). */
  fetchText(url: string): Promise<string>;
  /** MCP resource discovery (text resources only in v1). */
  listMcpResources?(serverId: string): Promise<{ uri: string; name: string; mimeType?: string }[]>;
  readMcpResourceText?(serverId: string, uri: string): Promise<string>;
}

/** Shared folder-walk logic so desktop and test implementations agree on bounds. */
export async function filterIngestibleFiles(
  listFiles: (folderPath: string) => Promise<string[]>,
  folderPath: string,
): Promise<string[]> {
  const all = await listFiles(folderPath);
  const ingestible = all
    .filter((file) => isIngestiblePath(file))
    .filter((file) => !/(^|\/)(node_modules|\.git|target|dist|\.venv|__pycache__)(\/|$)/.test(file))
    .sort((a, b) => a.localeCompare(b))
    .slice(0, MAX_FOLDER_FILES);
  return ingestible;
}

export type { KnowledgeSourceType };
