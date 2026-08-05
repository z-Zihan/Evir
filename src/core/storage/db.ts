import Dexie, { type Table } from "dexie";

export interface ProviderRecord {
  id: string;
  name: string;
  protocolId: string;
  baseUrl: string;
  apiKey: string;
  modelId: string;
  enabled: boolean;
  isDefault: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface ConversationRecord {
  id: string;
  title: string;
  providerId: string;
  modelId: string;
  createdAt: number;
  updatedAt: number;
  parentConversationId?: string;
  branchedFromMessageId?: string;
}

export interface AttachmentRecord {
  id: string;
  messageId: string;
  fileName: string;
  mimeType: string;
  size: number;
  data: string;
  type: "image" | "text";
  createdAt: number;
}

export interface ToolCallRecord {
  id: string;
  toolName: string;
  arguments: Record<string, unknown>;
}

export interface ToolResultRecord {
  toolCallId: string;
  toolName: string;
  success: boolean;
  output: string;
  error?: string;
}

export interface MessageRecord {
  id: string;
  conversationId: string;
  role: "user" | "assistant" | "system";
  content: string;
  status: "complete" | "streaming" | "error" | "stopped";
  errorMessage?: string;
  createdAt: number;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  };
  attachments?: AttachmentRecord[];
  toolCalls?: ToolCallRecord[];
  toolResults?: ToolResultRecord[];
}

export interface UsageRecord {
  id: string;
  conversationId?: string;
  providerId: string;
  modelId: string;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  evidence: "provider" | "estimated" | "unavailable";
  success: boolean;
  durationMs: number;
  firstTokenMs?: number;
  createdAt: number;
}

export interface SettingRecord {
  name: string;
  value: unknown;
}

export class EvirDB extends Dexie {
  providers!: Table<ProviderRecord, string>;
  conversations!: Table<ConversationRecord, string>;
  messages!: Table<MessageRecord, string>;
  attachments!: Table<AttachmentRecord, string>;
  usage_records!: Table<UsageRecord, string>;
  settings!: Table<SettingRecord, string>;

  constructor(name = "evir") {
    super(name);
    this.version(1).stores({
      providers: "id",
      conversations: "id, updatedAt",
      messages: "id, conversationId, createdAt",
      usage_records: "id, conversationId, createdAt",
      settings: "name",
    });
    this.version(2).stores({
      providers: "id",
      conversations: "id, updatedAt",
      messages: "id, conversationId, createdAt",
      attachments: "id, messageId",
      usage_records: "id, conversationId, createdAt",
      settings: "name",
    });
  }
}

export const db = new EvirDB();

export function createBranch(
  source: ConversationRecord,
  branchedFromMessageId: string,
): ConversationRecord {
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    title: `${source.title} (branch)`,
    providerId: source.providerId,
    modelId: source.modelId,
    createdAt: now,
    updatedAt: now,
    parentConversationId: source.id,
    branchedFromMessageId,
  };
}
