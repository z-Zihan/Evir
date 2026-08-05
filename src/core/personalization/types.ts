export type PersonalizationScope = "global" | "workspace" | "conversation";

export type EditablePromptDocumentId = "user" | "persona" | "soul" | "instructions";
export type ProtectedPromptDocumentId = "core" | "security" | "permissions" | "tool-policy";

export interface PersonalizationDocument {
  id: EditablePromptDocumentId;
  fileName: "USER.md" | "PERSONA.md" | "SOUL.md" | "INSTRUCTIONS.md";
  scope: PersonalizationScope;
  enabled: boolean;
  content: string;
  updatedAt: number;
}

export interface PersonalizationSettings {
  enabled: boolean;
  loadInPrivateSessions: boolean;
  activePersonaId?: string;
  conversationOverridesEnabled: boolean;
}

export const EDITABLE_PERSONALIZATION_DOCUMENTS = [
  { id: "user", fileName: "USER.md", advanced: false },
  { id: "persona", fileName: "PERSONA.md", advanced: false },
  { id: "instructions", fileName: "INSTRUCTIONS.md", advanced: false },
  { id: "soul", fileName: "SOUL.md", advanced: true },
] as const;

export const PROTECTED_PROMPT_DOCUMENTS = [
  "CORE.md",
  "SECURITY.md",
  "PERMISSIONS.md",
  "TOOL_POLICY.md",
] as const;

/**
 * User-editable documents are context, not authority. They must never replace,
 * weaken, or reorder protected Evir rules.
 */
export const PROMPT_LAYER_ORDER = [
  "evir-core",
  "security-and-permissions",
  "runtime-and-mode-policy",
  "user-custom-instructions",
  "persona-and-soul",
  "active-skills",
  "workspace-context",
  "conversation-overrides",
  "external-untrusted-content",
] as const;
