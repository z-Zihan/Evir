export interface VerificationResult {
  passed: boolean;
  evidence: string[];
  failures: string[];
}

export type VerificationMethod =
  | "typecheck"
  | "lint"
  | "test"
  | "build"
  | "git-diff"
  | "file-exists"
  | "file-checksum"
  | "page-state"
  | "mcp-schema"
  | "user-confirm";

export interface VerificationTask {
  method: VerificationMethod;
  target: string;
  expected?: string;
}

export interface VerificationPort {
  verify(task: VerificationTask): Promise<VerificationResult>;
}

export interface LoopDetectionConfig {
  maxRepeatedToolCalls: number;
  maxRepeatedFileEdits: number;
  maxUnchangedErrorRetries: number;
  maxNoProgressIterations: number;
}

export const DEFAULT_LOOP_DETECTION_CONFIG: LoopDetectionConfig = {
  maxRepeatedToolCalls: 3,
  maxRepeatedFileEdits: 3,
  maxUnchangedErrorRetries: 3,
  maxNoProgressIterations: 5,
};
