export type ProviderRegion = "international" | "china" | "local" | "custom";

export type ProtocolAdapterId =
  | "openai-responses"
  | "openai-chat-completions"
  | "anthropic-messages"
  | "gemini-interactions"
  | "gemini-generate-content"
  | "openai-compatible-responses"
  | "openai-compatible-chat"
  | "anthropic-compatible-messages"
  | "azure-openai-responses"
  | "azure-openai-chat"
  | "aws-bedrock-converse"
  | "vertex-gemini"
  | "ollama-native"
  | "mistral-native"
  | "cohere-chat-v2";

export type ProviderAuthMode =
  | "bearer-api-key"
  | "x-api-key"
  | "api-key-header"
  | "query-api-key"
  | "oauth-bearer"
  | "azure-entra"
  | "aws-sigv4"
  | "google-adc"
  | "none-local";

export interface ProviderOfficialLinks {
  website: string;
  console?: string;
  docs?: string;
  status?: string;
}

export interface ProviderEndpointPreset {
  id: string;
  label: string;
  baseUrl: string;
  region?: string;
  site?: "mainland" | "international" | "local";
}

/**
 * Provider maturity tier (§48) — MODEL-level, evidence-driven:
 * - "agent-verified": the LATEST required real eval (full suite, current
 *   version) for this provider+model passed every gate in provider-tiers.ts.
 * - "smoke-verified": the latest real eval passed every gate but only at
 *   smoke scale (≥10 tasks) — never claims full agent-verified.
 * - "needs-revalidation": a qualifying eval passed historically, but the
 *   latest real eval regressed (or the suite version moved past it).
 * - "protocol-verified": the vendor's protocol adapter (streaming + tool
 *   calls) is implemented and covered by automated protocol tests.
 * - "preset": a configuration template only — no agent-level evidence.
 *
 * Evidence NEVER transfers across models or endpoints: an entry for
 * provider "zhipu" + model "deepseek-x" cannot verify "glm-4.7" (§69).
 */
export type ProviderAgentTier =
  "agent-verified" | "smoke-verified" | "needs-revalidation" | "protocol-verified" | "preset";

export interface ProviderPreset {
  id: string;
  name: string;
  region: ProviderRegion;
  protocols: readonly ProtocolAdapterId[];
  recommendedProtocol: ProtocolAdapterId;
  authModes: readonly ProviderAuthMode[];
  endpoints: readonly ProviderEndpointPreset[];
  supportsModelListing: boolean;
  webDirectCandidate: boolean;
  agentTier: ProviderAgentTier;
  officialLinks?: ProviderOfficialLinks;
  notes?: readonly string[];
}

export type CapabilityEvidence = "preset" | "metadata" | "probe" | "user-override";

export interface ModelCapabilities {
  streaming: boolean;
  toolCalling: boolean;
  parallelToolCalling: boolean;
  vision: boolean;
  audioInput: boolean;
  structuredOutput: boolean;
  reasoning: boolean;
  usage: boolean;
  systemInstructions: boolean;
  maxContextTokens?: number;
  maxOutputTokens?: number;
}

export interface ModelProfile {
  providerId: string;
  protocol: ProtocolAdapterId;
  modelId: string;
  capabilities: ModelCapabilities;
  capabilityEvidence: Partial<Record<keyof ModelCapabilities, CapabilityEvidence>>;
  verifiedAt?: number;
}
