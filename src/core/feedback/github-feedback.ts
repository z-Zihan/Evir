export const EVIR_GITHUB_REPOSITORY_URL = "https://github.com/z-Zihan/Evir";
export const EVIR_NEW_ISSUE_URL = `${EVIR_GITHUB_REPOSITORY_URL}/issues/new/choose`;

export interface FeedbackDraft {
  title?: string;
  body?: string;
  labels?: readonly string[];
}

export function buildGitHubIssueUrl(draft: FeedbackDraft): string {
  const url = new URL(`${EVIR_GITHUB_REPOSITORY_URL}/issues/new`);
  if (draft.title) url.searchParams.set("title", draft.title);
  if (draft.body) url.searchParams.set("body", draft.body);
  if (draft.labels?.length) url.searchParams.set("labels", draft.labels.join(","));
  return url.toString();
}
