import {
  createConfiguredAdapter,
  isSupportedProtocol,
} from "../../core/providers/adapter-registry";
import { uuid } from "../../core/providers/adapters/openai-chat-utils";
import { getErrorDisplay } from "../../core/providers/error-messages";
import { ProviderErrorType } from "../../core/providers/stream-events";
import type { ProviderRecord, UsageRecord } from "../../core/storage/db";
import i18n from "../../i18n/config";
import { useUsageStore } from "../usage/usage-store";
import { logger } from "../../core/logging/logger";
import type { TokenBreakdown } from "../../core/usage/types";
import { activeTraceFor } from "../tracing/trace-recorder";

// Controllers are keyed by conversation so a Stop in one task aborts only that
// task's in-flight requests; concurrent conversations keep streaming.
const activeControllers = new Map<string, Set<AbortController>>();

function controllersFor(conversationId: string): Set<AbortController> {
  let set = activeControllers.get(conversationId);
  if (!set) {
    set = new Set();
    activeControllers.set(conversationId, set);
  }
  return set;
}

export function createActiveTaskController(conversationId: string): {
  signal: AbortSignal;
  dispose(): void;
} {
  const controller = new AbortController();
  controllersFor(conversationId).add(controller);
  return {
    signal: controller.signal,
    dispose: () => {
      const set = activeControllers.get(conversationId);
      if (!set) return;
      set.delete(controller);
      if (set.size === 0) activeControllers.delete(conversationId);
    },
  };
}

function formatProviderError(errorType: ProviderErrorType, providerMessage: string): string {
  const display = getErrorDisplay(errorType, (key) => i18n.t(key));
  const guidance = `${display.title}: ${display.description}`;
  const detail = providerMessage.trim();
  return detail ? `${guidance} ${i18n.t("errors.detail", { message: detail })}` : guidance;
}

export function providerReadinessError(provider: ProviderRecord): string | undefined {
  if (!provider.apiKey) return "chat.apiKeyMissing";
  // Ask the adapter registry which protocols are usable; a hardcoded subset
  // here drifted from the registry and blocked working azure/ollama setups.
  if (!isSupportedProtocol(provider.protocolId)) return "chat.protocolUnsupported";
}

/** Aborts in-flight requests for one conversation (undefined = every conversation). */
export function stopActiveStream(conversationId?: string): void {
  if (conversationId === undefined) {
    for (const [key, set] of activeControllers) {
      for (const controller of set) controller.abort();
      activeControllers.delete(key);
    }
    return;
  }
  const set = activeControllers.get(conversationId);
  if (!set) return;
  for (const controller of set) controller.abort();
  activeControllers.delete(conversationId);
}

function batchDeltas(onDelta: (content: string) => void) {
  let frame: number | null = null;
  let latest = "";
  const schedule = (content: string) => {
    latest = content;
    if (frame !== null) return;
    frame = requestAnimationFrame(() => {
      frame = null;
      onDelta(latest);
    });
  };
  const flush = (content: string) => {
    if (frame !== null) {
      cancelAnimationFrame(frame);
      frame = null;
    }
    onDelta(content);
  };
  return { schedule, flush };
}

export interface StreamResult {
  content: string;
  status: "complete" | "stopped" | "error";
  errorMessage?: string;
  /** Provider/provider-transport error classification for retry policy. */
  errorType?: string;
  /** Adapter-judged transient failure (timeout / network / rate limit). */
  retryable?: boolean;
  toolCalls?: { id: string; toolName: string; arguments: string }[];
}

export async function streamAssistant(
  provider: ProviderRecord,
  conversationId: string,
  messages: { role: string; content: unknown }[],
  onDelta: (delta: string) => void,
  tools?: unknown[],
  externalSignal?: AbortSignal,
  timeoutMs?: number,
): Promise<StreamResult> {
  const configuredAdapter = createConfiguredAdapter(provider.protocolId, {
    providerId: provider.id,
    baseUrl: provider.baseUrl,
    apiKey: provider.apiKey,
  });
  if (!configuredAdapter) {
    return {
      content: "",
      status: "error",
      errorMessage: "chat.protocolUnsupported",
    } satisfies StreamResult;
  }

  const controller = new AbortController();
  let timedOut = false;
  const timeout = timeoutMs
    ? globalThis.setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, timeoutMs)
    : undefined;
  const abortFromExternal = () => controller.abort();
  if (externalSignal?.aborted) controller.abort();
  else externalSignal?.addEventListener("abort", abortFromExternal, { once: true });
  controllersFor(conversationId).add(controller);
  let content = "";
  let status: StreamResult["status"] = "complete";
  let errorMessage: string | undefined;
  let errorType: ProviderErrorType | "TIMEOUT" | "INCOMPLETE_STREAM" | undefined;
  let lastRetryable = false;
  let completed = false;
  const toolCalls = new Map<string, { id: string; toolName: string; arguments: string }>();
  const startTime = Date.now();
  const requestId = uuid();
  let firstTokenMs: number | undefined;
  let reportedUsage: TokenBreakdown | undefined;
  const batched = batchDeltas(onDelta);

  logger.info("provider", "provider.request-started", {
    requestId,
    conversationId,
    providerId: provider.id,
    protocolId: provider.protocolId,
    modelId: provider.modelId,
    messageCount: messages.length,
    toolCount: tools?.length ?? 0,
  });

  // Turn trace (§22): chunk timing metadata for every stream kind, plus a
  // bounded redacted sample of the USER-VISIBLE text stream (§27) — never
  // reasoning/CoT. One recorder per assistant turn spans all agent-loop
  // requests; each request logged here contributes its own request span.
  const trace = activeTraceFor(conversationId);
  trace?.attachRequest(requestId);
  trace?.record("request.started", {
    summary: provider.modelId,
    durationMs: 0,
  });

  try {
    for await (const event of configuredAdapter.stream({
      modelId: provider.modelId,
      messages,
      ...(tools?.length ? { tools } : {}),
      signal: controller.signal,
    })) {
      if (event.type === "text-delta") {
        firstTokenMs ??= Date.now() - startTime;
        content += event.text;
        trace?.recordDelta("text", event.text.length);
        trace?.appendVisibleText(event.text);
        batched.schedule(content);
      } else if (event.type === "tool-call-start") {
        toolCalls.set(event.toolCallId, {
          id: event.toolCallId,
          toolName: event.toolName,
          arguments: "",
        });
        trace?.record("tool-call.created", {
          toolCallId: event.toolCallId,
          summary: event.toolName,
        });
      } else if (event.type === "tool-call-arguments-delta") {
        const call = toolCalls.get(event.toolCallId);
        if (call) call.arguments += event.argumentsDelta;
        trace?.recordDelta("tool-call-arguments", event.argumentsDelta.length);
      } else if (event.type === "usage") {
        reportedUsage = event.usage;
        trace?.recordUsage(event.usage.outputTokens);
      } else if (event.type === "error") {
        lastRetryable = Boolean(event.error.retryable);
        status = timedOut
          ? "error"
          : controller.signal.aborted || event.error.type === ProviderErrorType.CANCELLED
            ? "stopped"
            : "error";
        errorMessage = timedOut
          ? "chat.requestTimedOut"
          : status === "error"
            ? formatProviderError(event.error.type, event.error.message)
            : undefined;
        lastRetryable = timedOut ? true : lastRetryable;
        errorType = timedOut
          ? "TIMEOUT"
          : status === "stopped"
            ? ProviderErrorType.CANCELLED
            : event.error.type;
        trace?.record("stream.error", {
          status: status === "stopped" ? "cancelled" : "error",
          summary: errorType,
        });
        break;
      } else if (event.type === "response-complete") {
        completed = true;
        trace?.record("stream.completed", { status: "ok" });
      }
    }
  } catch (error) {
    status = timedOut ? "error" : controller.signal.aborted ? "stopped" : "error";
    errorMessage = timedOut
      ? "chat.requestTimedOut"
      : status === "error"
        ? formatProviderError(
            ProviderErrorType.PROVIDER_ERROR,
            error instanceof Error ? error.message : "",
          )
        : undefined;
    errorType = timedOut
      ? "TIMEOUT"
      : status === "stopped"
        ? ProviderErrorType.CANCELLED
        : ProviderErrorType.PROVIDER_ERROR;
  } finally {
    if (timeout !== undefined) globalThis.clearTimeout(timeout);
    const set = activeControllers.get(conversationId);
    set?.delete(controller);
    if (set?.size === 0) activeControllers.delete(conversationId);
    externalSignal?.removeEventListener("abort", abortFromExternal);
    batched.flush(content);
  }

  if (!completed && status === "complete") {
    status = "stopped";
    errorType = "INCOMPLETE_STREAM";
  }
  const completedAt = Date.now();
  const durationMs = completedAt - startTime;
  const usageRecord: UsageRecord = {
    id: requestId,
    conversationId,
    providerId: provider.id,
    modelId: provider.modelId,
    ...(reportedUsage?.inputTokens !== undefined ? { inputTokens: reportedUsage.inputTokens } : {}),
    ...(reportedUsage?.outputTokens !== undefined
      ? { outputTokens: reportedUsage.outputTokens }
      : {}),
    ...(reportedUsage?.totalTokens !== undefined ? { totalTokens: reportedUsage.totalTokens } : {}),
    evidence: reportedUsage ? "provider" : "unavailable",
    success: status === "complete" && completed,
    ...(errorType ? { errorType } : {}),
    durationMs,
    ...(firstTokenMs !== undefined ? { firstTokenMs } : {}),
    createdAt: completedAt,
  };
  try {
    await useUsageStore.getState().addRecord(usageRecord);
  } catch (error) {
    logger.error("usage", "usage.record-failed", {
      requestId,
      conversationId,
      errorType: error instanceof Error ? error.name : "Error",
    });
  }
  logger.info("provider", "provider.request-completed", {
    requestId,
    conversationId,
    providerId: provider.id,
    modelId: provider.modelId,
    status,
    errorType: errorType ?? null,
    completed,
    durationMs,
    ...(firstTokenMs !== undefined ? { firstTokenMs } : {}),
    usageEvidence: usageRecord.evidence,
    inputTokens: usageRecord.inputTokens ?? null,
    outputTokens: usageRecord.outputTokens ?? null,
    totalTokens: usageRecord.totalTokens ?? null,
    responseCharacters: content.length,
    toolCallCount: toolCalls.size,
  });
  return {
    content,
    status,
    ...(errorMessage !== undefined ? { errorMessage } : {}),
    ...(errorType !== undefined ? { errorType } : {}),
    ...(lastRetryable ? { retryable: true } : {}),
    ...(toolCalls.size > 0 ? { toolCalls: [...toolCalls.values()] } : {}),
  } satisfies StreamResult;
}
