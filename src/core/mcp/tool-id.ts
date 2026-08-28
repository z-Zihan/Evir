// Public tool-id derivation shared by the tool adapter and the MCP store.
// Lives outside tool-adapter.ts so feature code does not depend on an
// adapter-internal module layout.
const MAX_TOOL_NAME_LENGTH = 64;

function stableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function publicMcpToolId(serverId: string, rawName: string): string {
  const joined = `mcp__${serverId}__${rawName}`;
  const normalized = joined.replace(/[^A-Za-z0-9_-]/g, "_");
  if (normalized === joined && normalized.length <= MAX_TOOL_NAME_LENGTH) return normalized;
  const suffix = stableHash(`${serverId}\0${rawName}`);
  return `${normalized.slice(0, MAX_TOOL_NAME_LENGTH - suffix.length - 1)}_${suffix}`;
}
