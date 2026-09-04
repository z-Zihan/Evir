import type { ConversationRecord, MessageRecord } from "../../core/storage/db";
import type { InteractionMode } from "../../core/providers/tool-registry";
import type {
  RiskLevel,
  ToolApprovalDetails,
  ToolSource,
} from "../../core/providers/tool-registry";
import type { AgentLoopTurn, AgentMessage } from "./agent-loop";
import type { AgentRunContext } from "../../runtime/types";
import type { AgentRunRecord } from "./agent-run-record";
import type { ProcessedAttachment } from "./attachment-utils";

/**
 * Chat type contracts shared by the store and its execution modules
 * (send-message / stream-response / tool-approval / helpers). Types live here
 * so those modules never import each other's module graph just to name a
 * shape — the chat feature stays cycle-free at the type level as well as at
 * runtime (§circular-dependency governance).
 */

/** Live run state for ONE conversation — the unit of multi-task isolation. */
export interface StreamSlot {
  conversationId: string;
  /**
   * "preparing" covers the intake/plan round trips before any tokens stream;
   * "verifying" marks the post-execution evidence pass (run-phase machine).
   */
  phase: "preparing" | "streaming" | "verifying";
  /** Wall-clock of beginConversationStream; null while preparing. */
  startedAt: number | null;
  /** Latest streamed content — survives switching away and back. */
  content: string;
}

export interface PendingToolApproval {
  approvalId?: string;
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
  riskLevel?: RiskLevel;
  source?: ToolSource;
  approval?: ToolApprovalDetails;
  conversationId: string;
  messages: AgentMessage[];
  providerId: string;
  turn: AgentLoopTurn;
  agentRun: AgentRunContext;
  mode?: "plan" | "goal" | "agent";
  allowedToolIds?: string[];
  orchestration?: { runId: string; nodeId: string };
  remainingApprovals?: PendingToolApproval[];
  /** Workspace root captured by the originating run; continuations rebind to it. */
  workspaceRoot?: string | null;
}

export interface ChatState {
  conversations: ConversationRecord[];
  currentConversationId: string | null;
  messages: MessageRecord[];
  mode: InteractionMode;
  isStreaming: boolean;
  activeStreamConversationId: string | null;
  activeStreamStartedAt: number | null;
  /** Incremented on every stop so in-flight preparation sends can detect cancellation. */
  streamEpoch: number;
  streamingContent: string;
  error: string | null;
  pendingAttachments: ProcessedAttachment[];
  pendingToolApproval: PendingToolApproval | null;
  privateSession: boolean;
  privateConversationId: string | null;
  latestAgentRun: AgentRunRecord | null;
  selectedSkillIds: Set<string>;
  /** Source of truth for concurrent runs, keyed by conversationId. */
  streamSlots: Record<string, StreamSlot>;
  /** Per-conversation stop epochs (the global streamEpoch is kept for logging only). */
  streamEpochs: Record<string, number>;
  /** Pending tool approvals keyed by conversationId; the flat field mirrors the viewed one. */
  pendingApprovals: Record<string, PendingToolApproval>;
  /** Last settled outcome per conversation (background runs included) for sidebar status. */
  runOutcomes: Record<string, { status: "completed" | "failed" | "stopped"; at: number }>;
  /** Wall-clock of the last time each conversation was viewed (unread dots). */
  conversationViewedAt: Record<string, number>;
  loadConversations: () => Promise<void>;
  createConversation: (
    providerId: string,
    modelId: string,
    projectId?: string | null,
  ) => Promise<string>;
  createOrReuseConversation: (
    providerId: string,
    modelId: string,
    projectId?: string | null,
  ) => Promise<string>;
  selectConversation: (id: string) => Promise<void>;
  deleteConversation: (id: string) => Promise<void>;
  renameConversation: (id: string, title: string) => Promise<void>;
  togglePin: (id: string) => Promise<void>;
  updateConversationProvider: (providerId: string, modelId: string) => Promise<void>;
  /** Resolves after the run settles; onAccepted fires once the user message is safely accepted. */
  sendMessage: (text: string, onAccepted?: () => void) => Promise<boolean>;
  regenerate: () => Promise<void>;
  editMessage: (messageId: string, newContent: string) => Promise<void>;
  /**
   * Manual context compaction (压缩当前会话): summarizes older messages into the
   * versioned summary record and replaces the in-view history. Returns false
   * when the conversation is streaming/private, too short, or has no provider.
   */
  compactContext: () => Promise<boolean>;
  /** Stops ONE conversation's run (defaults to the viewed conversation); others keep running. */
  stopGeneration: (conversationId?: string) => void;
  addAttachment: (file: File) => Promise<void>;
  removeAttachment: (id: string) => void;
  clearAttachments: () => void;
  setMode: (mode: InteractionMode) => void;
  togglePrivateSession: () => void;
  approveTool: () => Promise<void>;
  denyTool: () => Promise<void>;
  branchConversation: (messageId: string) => Promise<string>;
  toggleSelectedSkill: (id: string) => void;
  clearSelectedSkills: () => void;
}
