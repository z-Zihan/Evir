/**
 * Desktop KnowledgeIoPort: file reads go through the same Rust fs boundary
 * the Files panel uses (validate_path_in_workspace enforces containment),
 * with the workspaceRoot chosen from the ingestion's granted roots so a
 * project's knowledge can be indexed even when another workspace is
 * selected. Web URLs are fetched once, explicitly, with a size cap (§66).
 */
import { invoke } from "@tauri-apps/api/core";
import { getRuntime } from "../../runtime/use-runtime";
import type { KnowledgeIoPort } from "../../core/knowledge/knowledge-io";
import { filterIngestibleFiles } from "../../core/knowledge/knowledge-io";
import { isIngestiblePath, MAX_INGEST_FILE_BYTES } from "../../core/knowledge/types";
import { logger } from "../../core/logging/logger";

/** Max chars fetched from a web page before extraction (bounded work). */
const MAX_WEB_FETCH_CHARS = 1_000_000;
const FETCH_TIMEOUT_MS = 20_000;

function containingRoot(path: string, roots: readonly string[]): string | null {
  const match = roots.find(
    (root) => path === root || path.startsWith(`${root.replace(/\/+$/, "")}/`),
  );
  return match ?? null;
}

export function createDesktopKnowledgeIo(roots: readonly string[]): KnowledgeIoPort {
  const readRoot = (path: string): string => containingRoot(path, roots) ?? path;
  return {
    readTextFile: async (path) => {
      const content = await invoke<string>("fs_read_file", {
        path,
        workspaceRoot: readRoot(path),
      });
      if (content.length > MAX_INGEST_FILE_BYTES) {
        throw new Error(`file exceeds ingestion cap (${MAX_INGEST_FILE_BYTES} chars)`);
      }
      return content;
    },
    readFileBase64: async (path) =>
      invoke<string>("fs_read_file_base64", { path, workspaceRoot: readRoot(path) }),
    listIngestibleFiles: async (folder) => {
      const all = await invoke<string[]>("fs_search_files", {
        path: folder,
        pattern: "",
        workspaceRoot: readRoot(folder),
      });
      const filtered = await filterIngestibleFiles(() => Promise.resolve(all), folder);
      return filtered.filter((file) => isIngestiblePath(file));
    },
    listMcpResources: async (serverId) => {
      const mcp = await getRuntime().getMcpRuntime?.();
      if (!mcp) throw new Error("MCP runtime unavailable");
      const resources = await mcp.listResources(serverId);
      return resources.map((resource) => ({
        uri: resource.uri,
        name: resource.name,
        ...(resource.mimeType ? { mimeType: resource.mimeType } : {}),
      }));
    },
    readMcpResourceText: async (serverId, uri) => {
      const mcp = await getRuntime().getMcpRuntime?.();
      if (!mcp) throw new Error("MCP runtime unavailable");
      return (await mcp.readResourceText(serverId, uri)).text;
    },
    fetchText: async (url) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      try {
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) throw new Error(`fetch failed: HTTP ${response.status}`);
        const text = (await response.text()).slice(0, MAX_WEB_FETCH_CHARS);
        logger.info("knowledge", "knowledge.web-fetched", {
          url: url.slice(0, 180),
          chars: text.length,
        });
        return text;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
