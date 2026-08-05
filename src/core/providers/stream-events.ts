import type { TokenBreakdown } from "../usage/types";
import type { ProtocolAdapterId } from "./types";

export enum ProviderErrorType {
  AUTH_FAILED = "AUTH_FAILED",
  CORS_BLOCKED = "CORS_BLOCKED",
  RATE_LIMITED = "RATE_LIMITED",
  INSUFFICIENT_BALANCE = "INSUFFICIENT_BALANCE",
  MODEL_NOT_FOUND = "MODEL_NOT_FOUND",
  CONTEXT_OVERFLOW = "CONTEXT_OVERFLOW",
  TOOL_CALL_UNSUPPORTED = "TOOL_CALL_UNSUPPORTED",
  VISION_UNSUPPORTED = "VISION_UNSUPPORTED",
  PROTOCOL_INCOMPATIBLE = "PROTOCOL_INCOMPATIBLE",
  NETWORK_ERROR = "NETWORK_ERROR",
  PROVIDER_ERROR = "PROVIDER_ERROR",
  CANCELLED = "CANCELLED",
}

export interface ProviderError {
  type: ProviderErrorType;
  message: string;
  retryable: boolean;
  providerDetails?: Record<string, unknown>;
}

export type ProviderStreamEvent =
  | { type: "response-start"; responseId: string; modelId: string; providerId: string }
  | { type: "text-delta"; text: string }
  | { type: "tool-call-start"; toolCallId: string; toolName: string }
  | { type: "tool-call-arguments-delta"; toolCallId: string; argumentsDelta: string }
  | { type: "tool-call-end"; toolCallId: string }
  | { type: "usage"; usage: TokenBreakdown }
  | { type: "provider-state"; state: Record<string, unknown> }
  | { type: "response-complete"; responseId: string; finishReason: string }
  | { type: "error"; error: ProviderError };

export interface ProtocolAdapter {
  id: ProtocolAdapterId;
  testConnection(config: {
    providerId: string;
    modelId: string;
    authConfig: Record<string, unknown>;
  }): Promise<{ ok: boolean; error?: ProviderError }>;
  stream(params: {
    modelId: string;
    messages: unknown[];
    tools?: unknown[];
    signal?: AbortSignal;
  }): AsyncIterable<ProviderStreamEvent>;
}
