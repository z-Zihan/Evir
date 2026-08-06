import type { ToolResultRecord } from "../storage/db";

export interface VerificationEvidence {
  type: "command_result" | "file_diff" | "git_status" | "assertion";
  toolName: string;
  success: boolean;
  summary: string;
  timestamp: number;
}

const VERIFICATION_TOOL_NAMES = new Set(["run_command", "git_status", "git_diff"]);

function evidenceTypeForTool(toolName: string): VerificationEvidence["type"] {
  switch (toolName) {
    case "run_command":
      return "command_result";
    case "git_diff":
      return "file_diff";
    case "git_status":
      return "git_status";
    default:
      return "assertion";
  }
}

function summarize(result: ToolResultRecord): string {
  const preview = result.output.slice(0, 200).trim();
  return preview.length > 0 ? preview : result.success ? "completed" : "failed";
}

export class TaskResolver {
  collectEvidence(toolResults: ToolResultRecord[], timestamp = Date.now()): VerificationEvidence[] {
    return toolResults.map((result) => ({
      type: evidenceTypeForTool(result.toolName),
      toolName: result.toolName,
      success: result.success,
      summary: summarize(result),
      timestamp,
    }));
  }

  hasVerificationEvidence(evidence: VerificationEvidence[]): boolean {
    return evidence.some((item) => VERIFICATION_TOOL_NAMES.has(item.toolName));
  }

  resolveTask(
    evidence: VerificationEvidence[],
    modelClaimsComplete: boolean,
  ): { complete: boolean; reason: string } {
    if (!modelClaimsComplete) {
      return { complete: false, reason: "Model has not claimed the task is complete." };
    }
    if (!this.hasVerificationEvidence(evidence)) {
      return {
        complete: false,
        reason:
          "Model claimed completion but no verification evidence (run_command, git_status, or git_diff) was found.",
      };
    }
    const failed = evidence.filter(
      (item) => VERIFICATION_TOOL_NAMES.has(item.toolName) && !item.success,
    );
    if (failed.length > 0) {
      return {
        complete: false,
        reason: `Verification evidence indicates failure: ${failed.map((item) => item.toolName).join(", ")}.`,
      };
    }
    return {
      complete: true,
      reason: "Model claimed completion and verification evidence supports it.",
    };
  }
}

export const taskResolver = new TaskResolver();
