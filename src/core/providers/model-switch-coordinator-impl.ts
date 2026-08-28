import type { MessageRecord, ProviderRecord } from "../storage/db";
import { TOOL_PERMISSION_REQUIRED } from "../tools/tool-executor";
import { createCheckpoint, buildHandoffMessage } from "../context/checkpoint";
import type { ModelSwitchCoordinator } from "./model-switch-coordinator";
import type {
  ModelSwitchAssessment,
  ModelSwitchRequest,
  ModelSwitchResult,
} from "./model-switching";
import { getStructuredStorage } from "../../runtime/structured-storage";
import { getRuntime, isNativeDesktopRuntime } from "../../runtime/use-runtime";
import { estimateMessagesTokens } from "../context/token-estimate";
import { retrieveMemoryContext } from "../memory/memory-retrieval";
import { DEFAULT_MAX_CONTEXT_TOKENS } from "./model-defaults";

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
    const storage = getStructuredStorage();
    const targetProvider = await storage.read<ProviderRecord>("providers", request.toProviderId);
    const desktopSecret =
      targetProvider && isNativeDesktopRuntime()
        ? await getRuntime().storage?.keychainGet(`provider:${targetProvider.id}:api-key`)
        : null;
    if (
      !targetProvider ||
      !targetProvider.enabled ||
      targetProvider.modelId !== request.toModelId
    ) {
      return {
        status: "blocked",
        requiresDataDestinationConfirmation: false,
        requiresModeDowngrade: false,
        requiresContextCompaction: false,
        blockReason: "target-model-unavailable",
        warnings: [],
      };
    }
    if (!targetProvider.apiKey && !desktopSecret) {
      return {
        status: "blocked",
        requiresDataDestinationConfirmation: false,
        requiresModeDowngrade: false,
        requiresContextCompaction: false,
        blockReason: "missing-credentials",
        warnings: [],
      };
    }

    const messages = request.privateSession
      ? []
      : await storage.query<MessageRecord>("messages", {
          conversationId: request.conversationId,
        });
    messages.sort((a, b) => a.createdAt - b.createdAt);

    const lastMessage = messages.at(-1);
    if (request.hasActiveExecution || hasActiveToolExecutionOrPendingApproval(lastMessage)) {
      return {
        status: "blocked",
        requiresDataDestinationConfirmation: false,
        requiresModeDowngrade: false,
        requiresContextCompaction: false,
        blockReason: "active-tool-execution",
        warnings: [],
      };
    }

    // The default project task can fall back to ordinary chat when the target
    // model has no tool calling. Explicit Plan/Goal modes cannot be preserved
    // because both rely on project-tool semantics.
    const requiresModeDowngrade =
      (request.mode === "plan" || request.mode === "goal") &&
      targetProvider.modelCapabilities?.toolCalling !== true;
    const maxContextTokens =
      targetProvider.modelCapabilities?.maxContextTokens ?? DEFAULT_MAX_CONTEXT_TOKENS;
    const estimatedTokens = estimateMessagesTokens(messages);
    if (estimatedTokens >= maxContextTokens) {
      return {
        status: "blocked",
        requiresDataDestinationConfirmation: request.fromProviderId !== request.toProviderId,
        requiresModeDowngrade,
        requiresContextCompaction: true,
        blockReason: "context-overflow",
        warnings: ["target-context-overflow"],
      };
    }
    const requiresContextCompaction = estimatedTokens >= maxContextTokens * 0.75;
    const requiresDataDestinationConfirmation = request.fromProviderId !== request.toProviderId;
    const warnings = [
      ...(requiresDataDestinationConfirmation ? ["cross-provider-data-destination"] : []),
      ...(requiresModeDowngrade ? ["target-tool-calling-unsupported"] : []),
      ...(requiresContextCompaction ? ["target-context-compaction-required"] : []),
    ];

    return {
      status:
        requiresDataDestinationConfirmation || requiresModeDowngrade
          ? "requires-confirmation"
          : "switched",
      requiresDataDestinationConfirmation,
      requiresModeDowngrade,
      requiresContextCompaction,
      warnings,
    };
  }

  async execute(
    request: ModelSwitchRequest,
    assessment: ModelSwitchAssessment,
  ): Promise<ModelSwitchResult> {
    if (assessment.status === "blocked") {
      return { status: "blocked" };
    }
    // Private sessions intentionally have no durable handoff, checkpoint, or
    // memory lookup. The live chat history remains in the chat store.
    if (request.privateSession) {
      return request.hasActiveExecution ? { status: "blocked" } : { status: "switched" };
    }

    const messages = await getStructuredStorage().query<MessageRecord>("messages", {
      conversationId: request.conversationId,
    });
    messages.sort((a, b) => a.createdAt - b.createdAt);
    const lastMessage = messages.at(-1);
    if (hasActiveToolExecutionOrPendingApproval(lastMessage)) {
      return { status: "blocked" };
    }

    const token = Symbol();
    this.inFlightSwitches.set(request.conversationId, token);
    const isCancelled = () => this.inFlightSwitches.get(request.conversationId) !== token;

    const objective = deriveObjective(messages);
    const memoryContext = await retrieveMemoryContext(getStructuredStorage(), {
      conversationId: request.conversationId,
      workspacePath: getRuntime().getWorkspaceRoot?.() ?? null,
      query: [...messages].reverse().find(({ role }) => role === "user")?.content ?? objective,
    });
    const checkpoint = await createCheckpoint(request.conversationId, messages, objective, {
      mode: request.mode,
      relevantMemoryIds: memoryContext.memoryIds,
    });
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
    await getStructuredStorage().write("messages", handoffMessage.id, handoffMessage);
    if (isCancelled()) return { status: "rolled-back" };

    this.inFlightSwitches.delete(request.conversationId);
    return { status: "switched", handoffMessage };
  }

  cancel(conversationId: string): void {
    this.inFlightSwitches.delete(conversationId);
  }
}
