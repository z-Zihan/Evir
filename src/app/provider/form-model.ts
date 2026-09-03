import { providerSchema, type ProviderConfigInput } from "../../features/provider/provider-store";
import type { ProviderPreset, ProviderRegion } from "../../core/providers/types";

/** Shared view-model for the provider catalog + form dialogs (§9/§6 split). */

export type ProviderField = keyof ProviderConfigInput;
export type FieldErrors = Partial<Record<ProviderField, "required" | "url">>;
export type PresetFilter = "all" | Exclude<ProviderRegion, "custom">;
export type DialogStep = "closed" | "presets" | "form";

export const SUPPORTED_PROTOCOLS = new Set<ProviderConfigInput["protocolId"]>([
  "openai-chat-completions",
  "openai-compatible-chat",
  "openai-responses",
  "anthropic-messages",
  "gemini-generate-content",
]);

export const PROTOCOL_OPTIONS: Array<{
  id: ProviderConfigInput["protocolId"];
  label: string;
}> = [
  { id: "openai-chat-completions", label: "OpenAI Chat Completions" },
  { id: "openai-compatible-chat", label: "OpenAI Compatible" },
  { id: "openai-responses", label: "OpenAI Responses" },
  { id: "anthropic-messages", label: "Anthropic Messages" },
  { id: "gemini-generate-content", label: "Gemini GenerateContent" },
];

export const EMPTY_FORM: ProviderConfigInput = {
  name: "",
  protocolId: "openai-compatible-chat",
  baseUrl: "",
  apiKey: "",
  modelId: "",
  toolCalling: false,
};

export function supportedProtocol(
  preset: ProviderPreset,
): ProviderConfigInput["protocolId"] | null {
  if (SUPPORTED_PROTOCOLS.has(preset.recommendedProtocol as ProviderConfigInput["protocolId"])) {
    return preset.recommendedProtocol as ProviderConfigInput["protocolId"];
  }
  return (
    (preset.protocols.find((protocol) =>
      SUPPORTED_PROTOCOLS.has(protocol as ProviderConfigInput["protocolId"]),
    ) as ProviderConfigInput["protocolId"] | undefined) ?? null
  );
}

export function validationErrors(
  form: ProviderConfigInput,
  required?: ProviderField[],
): FieldErrors {
  const result = providerSchema.safeParse(form);
  if (result.success) return {};
  const fields = required ? new Set(required) : null;
  const errors: FieldErrors = {};
  for (const field of ["name", "baseUrl", "apiKey", "modelId"] as const) {
    if ((!fields || fields.has(field)) && !form[field].trim()) errors[field] = "required";
  }
  for (const issue of result.error.issues) {
    const field = issue.path[0];
    if (typeof field !== "string" || (fields && !fields.has(field as ProviderField))) continue;
    const typed = field as ProviderField;
    if (!errors[typed]) errors[typed] = issue.code === "invalid_format" ? "url" : "required";
  }
  return errors;
}

export const providerInitial = (name: string) => name.trim().slice(0, 1).toUpperCase();
