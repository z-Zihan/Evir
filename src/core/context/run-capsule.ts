import type { MessageRecord } from "../storage/db";
import type { Checkpoint } from "./checkpoint";

export interface RunCapsule {
  objective: string;
  userConstraints: string[];
  pendingApprovals: string[];
  activeRunState: "idle" | "running" | "blocked" | "completed";
  fileChanges: string[];
  errors: string[];
  lastVerificationEvidence: string[];
  createdAt: number;
}

const CONSTRAINT_MARKERS = ["must not", "must", "don't", "不要", "必须"];
const FILE_CHANGE_TOOL_NAMES = new Set(["write_file", "apply_patch"]);
const VERIFICATION_TOOL_NAMES = new Set(["run_command", "git_status", "git_diff"]);

function containsConstraintMarker(content: string): boolean {
  const lower = content.toLowerCase();
  return CONSTRAINT_MARKERS.some(
    (marker) => lower.includes(marker.toLowerCase()) || content.includes(marker),
  );
}

function pendingApprovalOf(msg: MessageRecord): unknown {
  return (msg as MessageRecord & { pendingApproval?: unknown }).pendingApproval;
}

/**
 * Build a compact, structured snapshot of the current run for system prompt
 * injection — distinct from Checkpoint (recovery snapshot) and conversation
 * summaries (narrative). Optionally seeded with a Checkpoint's objective when
 * no user message is available yet.
 */
export function buildRunCapsule(messages: MessageRecord[], checkpoint?: Checkpoint): RunCapsule {
  const now = Date.now();

  const firstUserMessage = messages.find((msg) => msg.role === "user");
  const objective = firstUserMessage?.content ?? checkpoint?.objective ?? "";

  const userConstraints: string[] = [];
  const pendingApprovals: string[] = [];
  const fileChanges: string[] = [];
  const errors: string[] = [];
  const lastVerificationEvidence: string[] = [];

  let hasError = false;
  let hasPendingApproval = false;

  for (const msg of messages) {
    if (msg.role === "user" && containsConstraintMarker(msg.content)) {
      userConstraints.push(msg.content);
    }

    const pendingApproval = pendingApprovalOf(msg);
    if (pendingApproval) {
      hasPendingApproval = true;
      pendingApprovals.push(
        typeof pendingApproval === "string" ? pendingApproval : JSON.stringify(pendingApproval),
      );
    }

    if (msg.status === "error") {
      hasError = true;
      errors.push(msg.errorMessage ?? msg.content);
    }

    if (msg.toolCalls) {
      for (const call of msg.toolCalls) {
        if (FILE_CHANGE_TOOL_NAMES.has(call.toolName)) {
          const path = call.arguments?.path;
          if (typeof path === "string" && path.length > 0) {
            fileChanges.push(path);
          }
        }
      }
    }

    if (msg.toolResults) {
      for (const result of msg.toolResults) {
        if (!result.success) {
          hasError = true;
          errors.push(`${result.toolName}: ${result.output.slice(0, 200)}`);
        }
        if (VERIFICATION_TOOL_NAMES.has(result.toolName)) {
          lastVerificationEvidence.push(`${result.toolName}: ${result.output.slice(0, 200)}`);
        }
      }
    }
  }

  let activeRunState: RunCapsule["activeRunState"] = "idle";
  const lastMessage = messages[messages.length - 1];
  if (hasPendingApproval) {
    activeRunState = "blocked";
  } else if (hasError) {
    activeRunState = "blocked";
  } else if (lastMessage?.status === "streaming") {
    activeRunState = "running";
  } else if (lastMessage?.role === "assistant" && lastMessage.status === "complete") {
    activeRunState = "completed";
  }

  return {
    objective,
    userConstraints,
    pendingApprovals,
    activeRunState,
    fileChanges: Array.from(new Set(fileChanges)),
    errors,
    lastVerificationEvidence,
    createdAt: now,
  };
}

/**
 * Serialize a RunCapsule into a compact string suitable for system prompt
 * injection. Omits empty sections rather than rendering placeholders.
 */
export function serializeCapsule(capsule: RunCapsule): string {
  const lines: string[] = [
    `[Run Capsule]`,
    `Objective: ${capsule.objective}`,
    `State: ${capsule.activeRunState}`,
  ];

  if (capsule.userConstraints.length > 0) {
    lines.push(`Constraints:`);
    capsule.userConstraints.forEach((c) => lines.push(`  - ${c}`));
  }

  if (capsule.pendingApprovals.length > 0) {
    lines.push(`Pending approvals:`);
    capsule.pendingApprovals.forEach((p) => lines.push(`  - ${p}`));
  }

  if (capsule.fileChanges.length > 0) {
    lines.push(`Files changed:`);
    capsule.fileChanges.forEach((f) => lines.push(`  - ${f}`));
  }

  if (capsule.errors.length > 0) {
    lines.push(`Errors:`);
    capsule.errors.forEach((e) => lines.push(`  - ${e}`));
  }

  if (capsule.lastVerificationEvidence.length > 0) {
    lines.push(`Verification evidence:`);
    capsule.lastVerificationEvidence.forEach((v) => lines.push(`  - ${v}`));
  }

  return lines.join("\n");
}
