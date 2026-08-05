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
