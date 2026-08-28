import type { DoneWhenResult } from "./types";
import type { EvirRuntime } from "../../runtime/types";
import { TOOL_PERMISSION_REQUIRED } from "../tools/tool-executor";

/**
 * Goal-mode completion criteria. A condition is executable when it names a
 * command; everything else (review standards, manual checks) stays "manual"
 * and is surfaced to the user instead of being silently judged by the model.
 */

const RESULT_MARKERS =
  /\s*(?:→|->|=|:)?\s*(?:PASS(?:ES|ED)?|FAIL(?:S|ED)?|通过|不通过|成功|失败|exit\s*0|exit\s*1)\s*[。.]?\s*$/i;
// \b word boundaries never match next to CJK characters (\w is ASCII-only),
// so Chinese negations must be listed without them.
const FAIL_MARKERS = /\b(?:FAIL(?:S|ED)?|exit\s*1)\b|不通过|失败/i;
// A token is a runnable program when it is a known tool name or a relative
// path to a script — prose ("运行", "所有") is never treated as a program.
const KNOWN_PROGRAMS =
  /^(?:pnpm|npm|yarn|node|npx|cargo|rustc|python3?|pytest|make|git|go|tsc|vitest|playwright|eslint|prettier|shellcheck|sh|bash|zsh)(?:@[\w.-]+)?$/i;
const PATH_PROGRAM = /^(?:\.\/|\/|~\/|\.\.\/)|\.(?:sh|js|ts|mjs|cjs|py)$/i;
const CJK = /[\u3400-\u9fff\u3000-\u303f\uff00-\uffef]/;

export interface ParsedDoneWhen {
  kind: "command" | "manual";
  label: string;
  command?: string;
}

/** Split a shell-like command line into program + args honoring quotes. */
export function splitCommand(line: string): string[] {
  const matches = line.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) ?? [];
  return matches.map((token) => token.replace(/^["']|["']$/g, ""));
}

function stripResultMarkers(label: string): string {
  let stripped = label;
  let previous = "";
  // Markers can stack ("测试。通过。") — strip until stable.
  while (stripped !== previous) {
    previous = stripped;
    stripped = stripped.replace(RESULT_MARKERS, "").trim();
  }
  return stripped;
}

export function parseDoneWhenCriterion(condition: string): ParsedDoneWhen {
  const label = condition.trim();
  const withoutMarker = stripResultMarkers(label);
  if (withoutMarker.length === 0) return { kind: "manual", label };
  const tokens = splitCommand(withoutMarker);
  const program = tokens[0] ?? "";
  // Anchored program check: a hint appearing mid-prose ("运行 cargo test 且全部通过")
  // must not promote the prose to a command, and mixed CJK tokens ("test全部")
  // mean the criterion is not machine-parseable — both stay manual for the
  // user to confirm instead of spawning a nonexistent binary.
  const runnable =
    (KNOWN_PROGRAMS.test(program) || PATH_PROGRAM.test(program)) &&
    !tokens.some((token) => CJK.test(token));
  if (!runnable) return { kind: "manual", label };
  return { kind: "command", label, command: withoutMarker };
}

export const DONE_WHEN_COMMAND_TIMEOUT_MS = 120_000;

/**
 * Evaluates every Done-when condition. Command criteria re-run against the
 * project workspace: a non-zero exit is a failure no matter what the model
 * claimed. Manual criteria never block completion on their own — they are
 * reported for the user to confirm. Execution goes through the tool executor
 * (not raw storage) so the permission profile gates it like any other command.
 */
export async function evaluateDoneWhen(
  conditions: readonly string[],
  runtime: EvirRuntime,
  workspaceRoot: string | null,
): Promise<DoneWhenResult[]> {
  const results: DoneWhenResult[] = [];
  for (const condition of conditions) {
    const parsed = parseDoneWhenCriterion(condition);
    if (parsed.kind === "manual") {
      results.push({
        label: parsed.label,
        kind: "manual",
        status: "manual",
        evidence: "Requires user confirmation",
      });
      continue;
    }
    if (FAIL_MARKERS.test(parsed.label)) {
      // "X FAIL" style expectations are not supported as pass criteria.
      results.push({
        label: parsed.label,
        kind: "command",
        status: "skipped",
        evidence: "Negated expectations are not executable criteria",
      });
      continue;
    }
    if (!workspaceRoot || !runtime.storage || !runtime.toolExecutor) {
      results.push({
        label: parsed.label,
        kind: "command",
        status: "skipped",
        evidence: "No workspace available to verify the command",
      });
      continue;
    }
    const [program, ...args] = splitCommand(parsed.command ?? "");
    if (!program) {
      results.push({
        label: parsed.label,
        kind: "manual",
        status: "manual",
        evidence: "No runnable command detected",
      });
      continue;
    }
    try {
      const startedAt = Date.now();
      const outcome = await runtime.toolExecutor.execute(
        "run_command",
        { cwd: workspaceRoot, program, args, timeout_ms: DONE_WHEN_COMMAND_TIMEOUT_MS },
        // Done-when only runs inside goal mode; carrying that mode keeps the
        // executor's risk limits consistent with the run that declared it.
        { ...runtime, mode: "goal" as const },
      );
      if (outcome.error === TOOL_PERMISSION_REQUIRED) {
        results.push({
          label: parsed.label,
          kind: "command",
          status: "manual",
          evidence:
            "Command execution requires a permission profile that allows it (workspace or full)",
        });
        continue;
      }
      results.push({
        label: parsed.label,
        kind: "command",
        status: outcome.success ? "passed" : "failed",
        evidence: `${outcome.success ? "exit 0" : "failed"} in ${Date.now() - startedAt}ms: ${outcome.output.slice(0, 160)}`,
      });
    } catch (error) {
      results.push({
        label: parsed.label,
        kind: "command",
        status: "failed",
        evidence: error instanceof Error ? error.message : "Command could not run",
      });
    }
  }
  return results;
}

/** A goal's command criteria all passed (manual criteria do not block). */
export function doneWhenSatisfied(results: readonly DoneWhenResult[]): boolean {
  const executable = results.filter(({ kind }) => kind === "command");
  if (executable.length === 0) return true;
  return executable.every(({ status }) => status === "passed");
}
