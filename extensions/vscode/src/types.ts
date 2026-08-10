import { z } from "zod";

export const providerConfigSchema = z.object({
  protocolId: z.enum([
    "openai-chat-completions",
    "openai-compatible-chat",
    "openai-responses",
    "anthropic-messages",
    "gemini-generate-content",
    "ollama-native",
  ]),
  baseUrl: z.string().url(),
  modelId: z.string().trim().min(1).max(200),
  toolCalling: z.boolean(),
});

export type ProviderConfig = z.infer<typeof providerConfigSchema>;
export type ConversationMode = "ask" | "agent";

export interface ConversationMessage {
  id: string;
  role: "user" | "assistant" | "tool";
  content: string;
  createdAt: number;
  toolCallId?: string | undefined;
  name?: string | undefined;
}

const configureMessageSchema = z.object({
  type: z.literal("configure"),
  config: providerConfigSchema,
  apiKey: z.string().max(4096),
});

export const webviewMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("ready") }),
  configureMessageSchema,
  z.object({
    type: z.literal("test-provider"),
    config: providerConfigSchema,
    apiKey: z.string().max(4096),
  }),
  z.object({
    type: z.literal("send"),
    text: z.string().trim().min(1).max(100_000),
    mode: z.enum(["ask", "agent"]),
  }),
  z.object({ type: z.literal("stop") }),
  z.object({ type: z.literal("new-conversation") }),
  z.object({ type: z.literal("approve"), requestId: z.string().uuid() }),
  z.object({ type: z.literal("deny"), requestId: z.string().uuid() }),
]);

export type WebviewMessage = z.infer<typeof webviewMessageSchema>;

export type HostMessage =
  | {
      type: "state";
      configured: boolean;
      config?: ProviderConfig;
      hasApiKey: boolean;
      messages: ConversationMessage[];
      running: boolean;
      workspaceName?: string;
      workspaceTrusted: boolean;
      workspaceLocal: boolean;
      mode: ConversationMode;
    }
  | { type: "stream-start"; messageId: string }
  | { type: "stream-delta"; messageId: string; content: string }
  | { type: "stream-end"; messageId: string; status: "complete" | "stopped" | "error" }
  | { type: "notice"; level: "info" | "warning" | "error"; message: string }
  | { type: "open-config" }
  | {
      type: "approval";
      requestId: string;
      title: string;
      detail: string;
      risk: "write" | "execute";
    };
