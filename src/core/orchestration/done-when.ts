import type { DoneWhenResult } from "./types";
import type { EvirRuntime } from "../../runtime/types";

/**
 * Goal-mode completion criteria. A condition is executable when it names a
 * command; everything else (review standards, manual checks) stays "manual"
 * and is surfaced to the user instead of being silently judged by the model.
 */

const COMMAND_HINTS =
  /(pnpm|npm|yarn|node|npx|cargo|python3?|pytest|make|git|go test|tsc|vitest|playwright|eslint|prettier|\btest\b|\bcheck\b|\bbuild\b|\blint\b|\be2e\b)/i;
const RESULT_MARKERS =
  /\s*(?:→|->|=|:)?\s*(?:PASS(?:ES|ED)?|FAIL(?:S|ED)?|通过|不通过|成功|失败|exit\s*0|exit\s*1)\s*[。.]?\s*$/i;
const FAIL_MARKERS = /\b(FAIL(?:S|ED)?|不通过|失败|exit\s*1)\b/i;

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

export function parseDoneWhenCriterion(condition: string): ParsedDoneWhen {
  const label = condition.trim();
  const withoutMarker = label.replace(RESULT_MARKERS, "").trim();
  if (withoutMarker.length === 0 || !COMMAND_HINTS.test(withoutMarker)) {
    return { kind: "manual", label };
  }
  return { kind: "command", label, command: withoutMarker };
}

export const DONE_WHEN_COMMAND_TIMEOUT_MS = 120_000;

/**
 * Evaluates every Done-when condition. Command criteria re-run against the
 * project workspace: a non-zero exit is a failure no matter what the model
 * claimed. Manual criteria never block completion on their own — they are
 * reported for the user to confirm.
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
    if (!workspaceRoot || !runtime.storage) {
      results.push({
        label: parsed.label,
        kind: "command",
        status: "skipped",
        evidence: "No workspace available to verify the command",
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
      const outcome = await runtime.storage.runCommand(
        workspaceRoot,
        program,
        args,
        DONE_WHEN_COMMAND_TIMEOUT_MS,
      );
      results.push({
        label: parsed.label,
        kind: "command",
        status: outcome.success ? "passed" : "failed",
        evidence: `exit ${outcome.exit_code} in ${Date.now() - startedAt}ms: ${(outcome.stderr || outcome.stdout).slice(0, 160)}`,
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
