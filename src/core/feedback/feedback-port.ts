import type { FeedbackDraft } from "./github-feedback";

export interface FeedbackPort {
  createDraft(type: "bug" | "feature", diagnostics: boolean): Promise<FeedbackDraft>;
  buildIssueUrl(draft: FeedbackDraft): string;
  generateDiagnosticSummary(): Promise<{ summary: string; redacted: boolean }>;
}
