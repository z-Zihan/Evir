import { db, type MessageRecord } from "../storage/db";
import { TOOL_PERMISSION_REQUIRED } from "../tools/tool-executor";
import { createCheckpoint, buildHandoffMessage } from "../context/checkpoint";
import type { ModelSwitchCoordinator } from "./model-switch-coordinator";
import type {
  ModelSwitchAssessment,
  ModelSwitchRequest,
  ModelSwitchResult,
} from "./model-switching";

function hasActiveToolExecutionOrPendingApproval(message: MessageRecord | undefined): boolean {
  if (!message) return false;
  if (message.status === "streaming") return true;
  if (!message.toolCalls?.length) return false;
  return message.toolCalls.some((call) => {
    const result = message.toolResults?.find((r) => r.toolCallId === call.id);
    return !result || result.error === TOOL_PERMISSION_REQUIRED;
  });
}

function deriveObjective(messages: MessageRecord[]): string {
  const firstUserMessage = messages.find((m) => m.role === "user");
  const content = firstUserMessage?.content.trim();
  if (!content) return "Continue conversation";
  return content.length > 200 ? `${content.slice(0, 200)}…` : content;
}

export class ModelSwitchCoordinatorImpl implements ModelSwitchCoordinator {
  private readonly inFlightSwitches = new Map<string, symbol>();

  async assess(request: ModelSwitchRequest): Promise<ModelSwitchAssessment> {
    const targetProvider = await db.providers.get(request.toProviderId);
    if (!targetProvider?.apiKey) {
      return {
        status: "blocked",
        requiresDataDestinationConfirmation: false,
        requiresModeDowngrade: false,
        requiresContextCompaction: false,
        blockReason: "missing-credentials",
        warnings: [],
      };
    }

    const messages = await db.messages
      .where("conversationId")
      .equals(request.conversationId)
      .sortBy("createdAt");

    const lastMessage = messages.at(-1);
    if (hasActiveToolExecutionOrPendingApproval(lastMessage)) {
      return {
        status: "blocked",
        requiresDataDestinationConfirmation: false,
        requiresModeDowngrade: false,
        requiresContextCompaction: false,
        blockReason: "active-tool-execution",
        warnings: [],
      };
    }

    return {
      status: "switched",
      requiresDataDestinationConfirmation: false,
      requiresModeDowngrade: false,
      requiresContextCompaction: false,
      warnings: [],
    };
  }

  async execute(
    request: ModelSwitchRequest,
    assessment: ModelSwitchAssessment,
  ): Promise<ModelSwitchResult> {
    if (assessment.status === "blocked") {
      return { status: "blocked" };
    }

    const messages = await db.messages
      .where("conversationId")
      .equals(request.conversationId)
      .sortBy("createdAt");
    const lastMessage = messages.at(-1);
    if (hasActiveToolExecutionOrPendingApproval(lastMessage)) {
      return { status: "blocked" };
    }

    const token = Symbol();
    this.inFlightSwitches.set(request.conversationId, token);
    const isCancelled = () => this.inFlightSwitches.get(request.conversationId) !== token;

    const objective = deriveObjective(messages);
    const checkpoint = await createCheckpoint(request.conversationId, messages, objective);
    if (isCancelled()) return { status: "rolled-back" };

    const handoff = buildHandoffMessage(checkpoint, request.toModelId);
    const handoffMessage: MessageRecord = {
      id: crypto.randomUUID(),
      conversationId: request.conversationId,
      role: handoff.role,
      content: handoff.content,
      status: "complete",
      createdAt: Date.now(),
    };
    await db.messages.add(handoffMessage);
    if (isCancelled()) return { status: "rolled-back" };

    this.inFlightSwitches.delete(request.conversationId);
    return { status: "switched", handoffMessage };
  }

  cancel(conversationId: string): void {
    this.inFlightSwitches.delete(conversationId);
  }
}
