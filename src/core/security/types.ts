import type { RiskLevel } from "../providers/tool-registry";

export type PermissionPreset = "safe" | "standard" | "auto" | "custom";

export type NetworkPermissionTarget =
  | "model-provider"
  | "web-read"
  | "package-manager"
  | "git-remote"
  | "remote-mcp"
  | "provider-server-tool"
  | "local-file-upload";

export interface NetworkPolicy {
  allowedTargets: ReadonlySet<NetworkPermissionTarget>;
  uploadAllowed: boolean;
}

export interface PermissionRequest {
  toolId: string;
  riskLevel: RiskLevel;
  description: string;
  reversible: boolean;
}

export interface PermissionDecision {
  request: PermissionRequest;
  approved: boolean;
  scope: "once" | "session" | "workspace";
}

export interface ApprovalPort {
  request(request: PermissionRequest): Promise<PermissionDecision>;
}
