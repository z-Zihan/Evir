import Dexie, { type Table } from "dexie";

export interface ProviderRecord {
  id: string;
  name: string;
  protocolId: string;
  baseUrl: string;
  apiKey: string;
  modelId: string;
  modelCapabilities?: {
    streaming: boolean;
    toolCalling: boolean;
    maxContextTokens?: number;
  };
  capabilityEvidence?: {
    streaming: "preset" | "metadata" | "probe" | "user-override";
    toolCalling: "preset" | "metadata" | "probe" | "user-override";
    maxContextTokens?: "preset" | "metadata" | "probe" | "user-override";
  };
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
  // pinned is a non-indexed field — no Dexie schema upgrade needed.
  // Sorting by pinned is done in-memory (Sidebar.tsx).
  pinned?: number;
  /** Owning project; null/undefined = standalone chat. Never guessed from the legacy global workspace. */
  projectId?: string | null;
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
  exitCode?: number;
  startedAt?: number;
  completedAt?: number;
  durationMs?: number;
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
  activeSkills?: Array<{ id: string; name: string }>;
  toolCalls?: ToolCallRecord[];
  toolResults?: ToolResultRecord[];
  summaryMetadata?: {
    version: 1;
    sourceMessageIds: string[];
    sourceStartedAt: number;
    sourceEndedAt: number;
    archiveId: string;
  };
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
  errorType?: string;
  durationMs: number;
  firstTokenMs?: number;
  createdAt: number;
}

export interface SettingRecord {
  name: string;
  value: unknown;
}

export type PermissionProfile = "ask" | "workspace" | "full";

export interface ProjectRecord {
  id: string;
  displayName: string;
  /** True once the user renamed the project; rebinding must not overwrite a custom name. */
  nameIsCustom: boolean;
  rootPath: string;
  canonicalRootPath: string;
  pinned?: number;
  permissionProfile: PermissionProfile;
  additionalAccessRoots: string[];
  createdAt: number;
  updatedAt: number;
  lastOpenedAt: number;
}

export interface McpServerRecord {
  id: string;
  name: string;
  transport: "stdio" | "streamable-http";
  enabled: number;
  config: string;
  createdAt: number;
  updatedAt: number;
}

export interface GenericEntityRecord {
  id: string;
  [key: string]: unknown;
}

export class EvirDB extends Dexie {
  projects!: Table<ProjectRecord, string>;
  providers!: Table<ProviderRecord, string>;
  conversations!: Table<ConversationRecord, string>;
  messages!: Table<MessageRecord, string>;
  attachments!: Table<AttachmentRecord, string>;
  usage_records!: Table<UsageRecord, string>;
  mcpServers!: Table<McpServerRecord, string>;
  settings!: Table<SettingRecord, string>;
  agentRuns!: Table<GenericEntityRecord, string>;
  taskBriefs!: Table<GenericEntityRecord, string>;
  plans!: Table<GenericEntityRecord, string>;
  runSteps!: Table<GenericEntityRecord, string>;
  runEvents!: Table<GenericEntityRecord, string>;
  agentAssignments!: Table<GenericEntityRecord, string>;
  approvals!: Table<GenericEntityRecord, string>;
  toolExecutions!: Table<GenericEntityRecord, string>;
  artifacts!: Table<GenericEntityRecord, string>;
  memories!: Table<GenericEntityRecord, string>;
  traces!: Table<GenericEntityRecord, string>;

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
    this.version(3).stores({
      providers: "id",
      conversations: "id, updatedAt",
      messages: "id, conversationId, createdAt",
      attachments: "id, messageId",
      usage_records: "id, conversationId, createdAt",
      mcpServers: "id",
      settings: "name",
    });
    this.version(4).stores({
      providers: "id",
      conversations: "id, updatedAt",
      messages: "id, conversationId, createdAt",
      attachments: "id, messageId",
      usage_records: "id, conversationId, createdAt",
      mcpServers: "id",
      settings: "name",
      agentRuns: "id, conversationId, updatedAt",
      toolExecutions: "id, runId, createdAt",
    });
    this.version(5).stores({
      providers: "id",
      conversations: "id, updatedAt",
      messages: "id, conversationId, createdAt",
      attachments: "id, messageId",
      usage_records: "id, conversationId, createdAt",
      mcpServers: "id",
      settings: "name",
      agentRuns: "id, conversationId, updatedAt",
      toolExecutions: "id, runId, createdAt",
      artifacts: "id, relatedEntityId, createdAt",
    });
    this.version(6).stores({
      providers: "id",
      conversations: "id, updatedAt",
      messages: "id, conversationId, createdAt",
      attachments: "id, messageId",
      usage_records: "id, conversationId, createdAt",
      mcpServers: "id",
      settings: "name",
      agentRuns: "id, conversationId, updatedAt",
      toolExecutions: "id, runId, createdAt",
      artifacts: "id, relatedEntityId, createdAt",
      memories: "id, scope, type, updatedAt, enabled, pinned",
    });
    this.version(7).stores({
      providers: "id",
      conversations: "id, updatedAt",
      messages: "id, conversationId, createdAt",
      attachments: "id, messageId",
      usage_records: "id, conversationId, createdAt",
      mcpServers: "id",
      settings: "name",
      agentRuns: "id, conversationId, updatedAt",
      taskBriefs: "id, runId, conversationId, version, updatedAt",
      plans: "id, runId, conversationId, revision, updatedAt",
      runSteps: "id, runId, planId, status",
      runEvents: "id, runId, conversationId, timestamp, type",
      agentAssignments: "id, parentRunId, nodeId, status",
      approvals: "id, runId, nodeId, status",
      toolExecutions: "id, runId, createdAt",
      artifacts: "id, relatedEntityId, createdAt",
      memories: "id, scope, type, updatedAt, enabled, pinned",
    });
    this.version(8).stores({
      projects: "id",
      providers: "id",
      conversations: "id, updatedAt",
      messages: "id, conversationId, createdAt",
      attachments: "id, messageId",
      usage_records: "id, conversationId, createdAt",
      mcpServers: "id",
      settings: "name",
      agentRuns: "id, conversationId, updatedAt",
      taskBriefs: "id, runId, conversationId, version, updatedAt",
      plans: "id, runId, conversationId, revision, updatedAt",
      runSteps: "id, runId, planId, status",
      runEvents: "id, runId, conversationId, timestamp, type",
      agentAssignments: "id, parentRunId, nodeId, status",
      approvals: "id, runId, nodeId, status",
      toolExecutions: "id, runId, createdAt",
      artifacts: "id, relatedEntityId, createdAt",
      memories: "id, scope, type, updatedAt, enabled, pinned",
    });
    this.version(9).stores({
      projects: "id",
      providers: "id",
      conversations: "id, updatedAt",
      messages: "id, conversationId, createdAt",
      attachments: "id, messageId",
      usage_records: "id, conversationId, createdAt",
      mcpServers: "id",
      settings: "name",
      agentRuns: "id, conversationId, updatedAt",
      taskBriefs: "id, runId, conversationId, version, updatedAt",
      plans: "id, runId, conversationId, revision, updatedAt",
      runSteps: "id, runId, planId, status",
      runEvents: "id, runId, conversationId, timestamp, type",
      agentAssignments: "id, parentRunId, nodeId, status",
      approvals: "id, runId, nodeId, status",
      toolExecutions: "id, runId, createdAt",
      artifacts: "id, relatedEntityId, createdAt",
      memories: "id, scope, type, updatedAt, enabled, pinned",
      traces: "id, conversationId, startedAt",
    });
  }
}

export const db = new EvirDB();
