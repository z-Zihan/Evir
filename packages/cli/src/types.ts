import { z } from "zod";

export const protocolSchema = z.enum([
  "openai-chat-completions",
  "openai-compatible-chat",
  "openai-responses",
  "anthropic-messages",
  "gemini-generate-content",
  "ollama-native",
]);

export const cliConfigSchema = z
  .object({
    id: z.string().trim().min(1).max(200),
    name: z.string().trim().min(1).max(100),
    protocolId: protocolSchema,
    baseUrl: z.string().url(),
    modelId: z.string().trim().min(1).max(200),
    toolCalling: z.boolean().default(false),
    maxContextTokens: z.number().int().positive().optional(),
    enabled: z.boolean().default(true),
    isDefault: z.boolean().default(false),
    createdAt: z.number().int().nonnegative(),
    updatedAt: z.number().int().nonnegative(),
  })
  .strict();

export type CliConfig = z.infer<typeof cliConfigSchema>;

export const sharedProviderDocumentSchema = z
  .object({
    version: z.literal(1),
    providers: z.array(cliConfigSchema).max(100),
  })
  .strict();

export type SharedProviderDocument = z.infer<typeof sharedProviderDocumentSchema>;

export type ParsedCommand =
  | { command: "help" }
  | { command: "version" }
  | { command: "doctor" }
  | { command: "config-path" }
  | {
      command: "configure";
      values: {
        protocolId?: string;
        baseUrl?: string;
        modelId?: string;
        toolCalling?: boolean;
      };
    }
  | { command: "ask"; prompt?: string }
  | { command: "agent"; prompt?: string; workspace: string };
