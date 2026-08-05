export type UsageEvidence = "provider" | "tokenizer-estimate" | "unavailable";

export interface TokenBreakdown {
  inputTokens?: number;
  outputTokens?: number;
  cachedInputTokens?: number;
  cacheWriteTokens?: number;
  reasoningTokens?: number;
  toolTokens?: number;
  totalTokens?: number;
}

export interface UsageRecord {
  id: string;
  conversationId?: string;
  runId?: string;
  requestId?: string;
  providerId: string;
  protocolId: string;
  modelId: string;
  startedAt: number;
  completedAt?: number;
  usage: TokenBreakdown;
  usageEvidence: UsageEvidence;
  estimatedCost?: {
    amount: number;
    currency: string;
    pricingVersion: string;
    isEstimate: true;
  };
  persisted: boolean;
}

export interface UsageSummaryFilter {
  from?: number;
  to?: number;
  providerIds?: readonly string[];
  modelIds?: readonly string[];
  conversationId?: string;
}

export interface UsageRecorder {
  record(record: UsageRecord): Promise<void>;
  summarize(filter: UsageSummaryFilter): Promise<TokenBreakdown>;
  clear(filter?: UsageSummaryFilter): Promise<void>;
}
