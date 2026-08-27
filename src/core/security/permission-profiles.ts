import type { RiskLevel } from "../providers/tool-registry";
import type { PermissionProfile } from "../storage/db";

/**
 * Permission context captured with an agent run. Mode capabilities (e.g.
 * Plan's read-only limit) are enforced before and independently of this —
 * Full Access can never upgrade a Plan run into writing.
 */
export interface PermissionContext {
  profile: PermissionProfile;
  /** Canonical roots: project root plus additional access roots. */
  roots: string[];
}

export type PermissionDecision = {
  autoApproved: boolean;
  reason:
    | "read-only"
    | "full-access"
    | "within-workspace"
    | "outside-roots"
    | "unknown-path"
    | "ask-profile"
    | "no-permission-context";
};

function comparable(path: string): string {
  const lower = /^[A-Za-z]:\//.test(path);
  const normalized = path.replace(/[\\/]+$/, "");
  // Resolve "." and ".." lexically so traversal strings cannot pass a prefix
  // check (e.g. /root/../other must not count as inside /root).
  const segments: string[] = [];
  for (const segment of normalized.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  const resolved = segments.join("/");
  return lower ? `/${resolved}`.toLowerCase() : `/${resolved}`;
}

export function isInsideRoots(path: string, roots: readonly string[]): boolean {
  const target = comparable(path);
  return roots.some((root) => {
    const boundary = comparable(root);
    return target === boundary || target.startsWith(`${boundary}/`);
  });
}

/**
 * Resolves whether an L2+ tool call may execute without an explicit approval.
 * Read-only tools always run; "ask" always requests approval; "workspace"
 * auto-approves inside the granted roots; "full" auto-approves everywhere the
 * tool layer still permits.
 */
export function resolveExecutionPermission(
  context: PermissionContext | null | undefined,
  riskLevel: RiskLevel,
  candidatePath: string | null,
): PermissionDecision {
  if (riskLevel === "L0" || riskLevel === "L1") {
    return { autoApproved: true, reason: "read-only" };
  }
  if (!context) return { autoApproved: false, reason: "no-permission-context" };
  if (context.profile === "full") return { autoApproved: true, reason: "full-access" };
  if (context.profile === "workspace") {
    if (candidatePath && isInsideRoots(candidatePath, context.roots)) {
      return { autoApproved: true, reason: "within-workspace" };
    }
    return {
      autoApproved: false,
      reason: candidatePath ? "outside-roots" : "unknown-path",
    };
  }
  return { autoApproved: false, reason: "ask-profile" };
}

/** Best-effort path/cwd extraction from tool arguments for root containment. */
export function candidatePathFromArgs(args: Record<string, unknown>): string | null {
  for (const key of ["path", "file_path", "cwd", "directory"]) {
    const value = args[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return null;
}
