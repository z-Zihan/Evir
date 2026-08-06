import { useUsageStore } from "../features/usage/usage-store";

export function useConversationTokenCount(conversationId: string | null): number {
  return useUsageStore((s) => {
    if (!conversationId) return 0;
    return s.records
      .filter((r) => r.conversationId === conversationId)
      .reduce((sum, r) => sum + (r.totalTokens ?? (r.inputTokens ?? 0) + (r.outputTokens ?? 0)), 0);
  });
}
