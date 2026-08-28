import { z } from "zod";
import type { ComponentDefinition, ComponentRuntimePort } from "../../core/components/types";
import { createContextBudgetManager } from "../../core/context/context-budget-manager";
import { logger } from "../../core/logging/logger";
import { retrieveMemoryContext } from "../../core/memory/memory-retrieval";
import { routeSkill } from "../../core/skills/skill-router";
import { taskResolver } from "../../core/tools/verification-evidence";
import { requiresToolCalling } from "../../core/providers/tool-registry";
import type {
  HarnessEvent,
  HarnessMiddleware,
  HarnessMiddlewareId,
  HarnessToolCallEvent,
} from "../../core/harness/types";

const emptyConfigSchema = z.object({}).strict().optional();

function parseEmptyConfig(input: unknown): null {
  emptyConfigSchema.parse(input);
  return null;
}
const loopConfigSchema = z
  .object({
    warnRepeatedToolCalls: z.number().int().min(1).max(100).default(6),
    stopRepeatedToolCalls: z.number().int().min(2).max(100).default(12),
    stopUnchangedErrors: z.number().int().min(2).max(100).default(12),
    stopFailedRetries: z.number().int().min(1).max(20).default(2),
  })
  .strict()
  .optional()
  .transform((value) => ({
    warnRepeatedToolCalls: value?.warnRepeatedToolCalls ?? 6,
    stopRepeatedToolCalls: value?.stopRepeatedToolCalls ?? 12,
    stopUnchangedErrors: value?.stopUnchangedErrors ?? 12,
    stopFailedRetries: value?.stopFailedRetries ?? 2,
  }))
  .refine((value) => value.warnRepeatedToolCalls < value.stopRepeatedToolCalls, {
    message: "Loop warning threshold must be lower than stop threshold",
  });

function component<TConfig>(
  id: HarnessMiddlewareId,
  parseConfig: (input: unknown) => TConfig,
  createMiddleware: (config: TConfig) => HarnessMiddleware,
): ComponentDefinition<TConfig> {
  return {
    manifest: {
      id: `evir.harness.${id}`,
      version: "1.0.0",
      kind: "harness-middleware",
      targets: ["web", "desktop"],
      provides: [`harness-middleware:${id}`],
      requires: ["service:harness-middleware-registry"],
      defaultEnabled: true,
      trust: "builtin",
    },
    parseConfig,
    activate(context, config) {
      context.registerHarnessMiddleware(createMiddleware(config));
    },
  };
}

function passthrough(
  id: HarnessMiddlewareId,
  execute: HarnessMiddleware["execute"],
): HarnessMiddleware {
  return { id, version: "1.0.0", execute };
}

const inputNormalization = component("input-normalization", parseEmptyConfig, () =>
  passthrough("input-normalization", (event, next) => {
    if (event.type !== "request") return next(event);
    return next({
      ...event,
      normalizedInput: event.userInput.replace(/\r\n?/g, "\n").trim(),
    });
  }),
);

const modePolicy = component("mode-policy", parseEmptyConfig, () =>
  passthrough("mode-policy", (event, next) => {
    if (event.type !== "request") return next(event);
    return next({
      ...event,
      effectiveMode: event.target === "web" ? "ask" : event.effectiveMode,
    });
  }),
);

const capabilityGate = component("capability-gate", parseEmptyConfig, () =>
  passthrough("capability-gate", (event, next) => {
    if (
      event.type !== "request" ||
      !requiresToolCalling(event.effectiveMode) ||
      event.providerToolCalling
    ) {
      return next(event);
    }
    return next({ ...event, blocked: true, blockReason: "agent-requires-tool-calling" });
  }),
);

const contextBudget = component("context-budget", parseEmptyConfig, () => {
  const manager = createContextBudgetManager();
  return passthrough("context-budget", (event, next) => {
    if (event.type !== "context-budget") return next(event);
    return next({
      ...event,
      snapshot: manager.snapshot(event.modelId, event.maxContextTokens, event.estimatedInputTokens),
    });
  });
});

const skillRouting = component("skill-routing", parseEmptyConfig, () =>
  passthrough("skill-routing", (event, next) => {
    if (event.type !== "skill-routing") return next(event);
    const result = routeSkill(event.userInput, event.skills, new Set(event.enabledSkillIds));
    const compatible = result.matchedSkills.filter(
      (skill) => event.mode !== "ask" || skill.manifest.capabilities.length === 0,
    );
    return next({
      ...event,
      matchedSkillIds: compatible.map(({ manifest }) => manifest.id),
      matchReasons: Object.fromEntries(
        compatible.map(({ manifest }) => [manifest.id, result.matchReasons.get(manifest.id) ?? []]),
      ),
    });
  }),
);

const memoryRetrieval = component("memory-retrieval", parseEmptyConfig, () =>
  passthrough("memory-retrieval", async (event, next) => {
    if (event.type !== "memory-retrieval") return next(event);
    try {
      const result = await retrieveMemoryContext(event.storage, {
        conversationId: event.conversationId,
        workspacePath: event.workspacePath,
        query: event.query,
        maxCharacters: event.maxCharacters,
      });
      return next({
        ...event,
        context: result.context,
        memories: result.memories,
        memoryIds: result.memoryIds,
      });
    } catch (error) {
      logger.warn("memory", "memory.context-load-failed", {
        conversationId: event.conversationId,
        error: error instanceof Error ? error.message : String(error),
      });
      return next(event);
    }
  }),
);

export function createLoopDetectionMiddleware(
  config: z.output<typeof loopConfigSchema>,
): HarnessMiddleware {
  const callsByRun = new Map<string, Map<string, number>>();
  const errorsByRun = new Map<string, Map<string, number>>();
  const consecutiveFailuresByRun = new Map<string, Map<string, number>>();
  return passthrough("loop-detection", (event, next) => {
    if (event.type !== "tool-call") return next(event);
    const runId = event.runId ?? event.conversationId;
    if (event.phase === "run-end") {
      callsByRun.delete(runId);
      errorsByRun.delete(runId);
      consecutiveFailuresByRun.delete(runId);
      return next(event);
    }
    if (event.phase === "before-execute" && event.toolName) {
      const calls = callsByRun.get(runId) ?? new Map<string, number>();
      callsByRun.set(runId, calls);
      const key = `${event.toolName}:${JSON.stringify(event.arguments ?? {})}`;
      const occurrences = (calls.get(key) ?? 0) + 1;
      calls.set(key, occurrences);
      // 相同调用已连续失败足够多次：再试只会刷屏，直接停止并交给用户决策
      const consecutiveFailures = consecutiveFailuresByRun.get(runId)?.get(key) ?? 0;
      if (consecutiveFailures >= config.stopFailedRetries) {
        return next(
          withLoopSignal(
            event,
            "stop",
            consecutiveFailures,
            `Repeated failed ${event.toolName} call`,
            "repeated-failed-call",
          ),
        );
      }
      if (occurrences >= config.stopRepeatedToolCalls) {
        return next(withLoopSignal(event, "stop", occurrences, `Repeated ${event.toolName} call`));
      }
      if (occurrences === config.warnRepeatedToolCalls) {
        return next(
          withLoopSignal(event, "warning", occurrences, `Repeated ${event.toolName} call`),
        );
      }
    }
    if (event.phase === "after-execute" && event.result) {
      const failed = Boolean(event.result.error) || event.result.success === false;
      if (event.toolName) {
        const key = `${event.toolName}:${JSON.stringify(event.arguments ?? {})}`;
        const failures = consecutiveFailuresByRun.get(runId) ?? new Map<string, number>();
        consecutiveFailuresByRun.set(runId, failures);
        failures.set(key, failed ? (failures.get(key) ?? 0) + 1 : 0);
      }
      if (event.result.error) {
        const errors = errorsByRun.get(runId) ?? new Map<string, number>();
        errorsByRun.set(runId, errors);
        const occurrences = (errors.get(event.result.error) ?? 0) + 1;
        errors.set(event.result.error, occurrences);
        if (occurrences >= config.stopUnchangedErrors) {
          return next(
            withLoopSignal(event, "stop", occurrences, `Unchanged error: ${event.result.error}`),
          );
        }
      }
    }
    return next(event);
  });
}

function withLoopSignal(
  event: HarnessToolCallEvent,
  severity: "warning" | "stop",
  occurrences: number,
  summary: string,
  type: "repeated-tool-call" | "repeated-failed-call" = "repeated-tool-call",
): HarnessToolCallEvent {
  return {
    ...event,
    blocked: severity === "stop" || event.blocked,
    ...(severity === "stop" ? { blockReason: "loop-detected" } : {}),
    loopSignal: { type, severity, occurrences, summary },
  };
}

const loopDetection = component(
  "loop-detection",
  (input) => loopConfigSchema.parse(input),
  createLoopDetectionMiddleware,
);

const checkpoint = component("checkpoint", parseEmptyConfig, () =>
  passthrough("checkpoint", async (event, next) => {
    if (
      event.type !== "checkpoint" ||
      event.privateSession ||
      event.compressionStage !== "checkpoint-compaction"
    ) {
      return next(event);
    }
    try {
      await event.persistCheckpoint();
      logger.debug("context", "checkpoint.created", { conversationId: event.conversationId });
      return next({ ...event, persisted: true });
    } catch (error) {
      logger.error("context", "checkpoint.create-failed", {
        conversationId: event.conversationId,
        error: error instanceof Error ? error.message : String(error),
      });
      return next(event);
    }
  }),
);

const verification = component("verification", parseEmptyConfig, () =>
  passthrough("verification", (event, next) => {
    if (event.type !== "completion") return next(event);
    const verificationEvidence = taskResolver.collectEvidence(event.toolResults);
    return next({
      ...event,
      verificationEvidence,
      resolution: taskResolver.resolveTask(verificationEvidence, event.modelClaimsComplete),
    });
  }),
);

const observability = component("observability", parseEmptyConfig, () =>
  passthrough("observability", async (event, next) => {
    const startedAt = performance.now();
    try {
      const result = await next(event);
      logger.debug("agent", "harness.event", {
        type: event.type,
        conversationId: event.conversationId,
        runId: event.runId,
        durationMs: Math.round(performance.now() - startedAt),
      });
      return result;
    } catch (error) {
      logger.error("agent", "harness.event-failed", {
        type: event.type,
        conversationId: event.conversationId,
        runId: event.runId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }),
);

export const BUILTIN_HARNESS_COMPONENTS = [
  inputNormalization,
  modePolicy,
  capabilityGate,
  contextBudget,
  skillRouting,
  memoryRetrieval,
  loopDetection,
  checkpoint,
  verification,
  observability,
] as const;

export function registerBuiltinHarnessComponents(
  runtime: Pick<ComponentRuntimePort, "register">,
): void {
  runtime.register(inputNormalization);
  runtime.register(modePolicy);
  runtime.register(capabilityGate);
  runtime.register(contextBudget);
  runtime.register(skillRouting);
  runtime.register(memoryRetrieval);
  runtime.register(loopDetection);
  runtime.register(checkpoint);
  runtime.register(verification);
  runtime.register(observability);
}

export function createProtectedToolPolicyMiddleware(): HarnessMiddleware {
  return passthrough("tool-policy", (event: HarnessEvent, next) => {
    if (
      event.type !== "tool-call" ||
      event.phase !== "before-execute" ||
      !event.toolName ||
      event.allowedToolIds.has(event.toolName)
    ) {
      return next(event);
    }
    return next({ ...event, blocked: true, blockReason: "tool-not-allowed" });
  });
}
