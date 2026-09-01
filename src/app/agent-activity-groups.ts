import type { ToolCallRecord, ToolResultRecord } from "../core/storage/db";

/**
 * Summary-first tool activity (§40–41): consecutive calls of one category
 * collapse into a single group row ("Inspected project · 17 reads",
 * "Changed 5 files", "Verified in browser"). The full timeline stays one
 * click away — nothing is hidden permanently.
 */

export type ToolGroupKind = "inspect" | "change" | "command" | "browser" | "other";

export interface GroupedToolCall {
  call: ToolCallRecord;
  result: ToolResultRecord | undefined;
}

export interface ToolCallGroup {
  kind: ToolGroupKind;
  calls: GroupedToolCall[];
}

const INSPECT_TOOLS = new Set([
  "read_file",
  "list_directory",
  "search_files",
  "search_docs",
  "file_stat",
  "git_status",
]);

const CHANGE_TOOLS = new Set([
  "write_file",
  "apply_patch",
  "create_directory",
  "create_snapshot",
  "restore_snapshot",
]);

const COMMAND_TOOLS = new Set(["run_command", "git_diff"]);

export function toolGroupKind(toolName: string): ToolGroupKind {
  if (toolName.startsWith("browser_")) return "browser";
  if (INSPECT_TOOLS.has(toolName)) return "inspect";
  if (CHANGE_TOOLS.has(toolName)) return "change";
  if (COMMAND_TOOLS.has(toolName)) return "command";
  return "other";
}

export function groupToolCalls(
  toolCalls: readonly ToolCallRecord[],
  toolResults: readonly ToolResultRecord[],
): ToolCallGroup[] {
  const resultsByCallId = new Map(toolResults.map((result) => [result.toolCallId, result]));
  const groups: ToolCallGroup[] = [];
  for (const call of toolCalls) {
    const kind = toolGroupKind(call.toolName);
    const last = groups[groups.length - 1];
    if (last && last.kind === kind) {
      last.calls.push({ call, result: resultsByCallId.get(call.id) });
    } else {
      groups.push({ kind, calls: [{ call, result: resultsByCallId.get(call.id) }] });
    }
  }
  return groups;
}

function callPath(call: ToolCallRecord): string | null {
  const value = call.arguments["path"] ?? call.arguments["file_path"];
  return typeof value === "string" ? value : null;
}

export interface GroupSummary {
  labelKey: string;
  /** Interpolation values for the label. */
  values: Record<string, number | string>;
}

export function groupSummary(group: ToolCallGroup): GroupSummary {
  const count = group.calls.length;
  switch (group.kind) {
    case "inspect": {
      const files = new Set(
        group.calls
          .map(({ call }) => callPath(call))
          .filter((path): path is string => path !== null),
      );
      const reads = group.calls.filter(({ call }) => call.toolName === "read_file").length;
      return {
        labelKey: "tools.group.inspect",
        values: { count, files: files.size, reads },
      };
    }
    case "change": {
      const files = new Set(
        group.calls
          .map(({ call }) => callPath(call))
          .filter((path): path is string => path !== null),
      );
      return { labelKey: "tools.group.change", values: { count, files: files.size } };
    }
    case "command":
      return { labelKey: "tools.group.command", values: { count } };
    case "browser":
      return { labelKey: "tools.group.browser", values: { count } };
    case "other":
      return { labelKey: "tools.group.other", values: { count } };
  }
}
