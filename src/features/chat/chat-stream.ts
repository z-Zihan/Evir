import { createConfiguredAdapter } from "../../core/providers/adapter-registry";
import { getErrorDisplay } from "../../core/providers/error-messages";
import { ProviderErrorType } from "../../core/providers/stream-events";
import type { ProviderRecord, UsageRecord } from "../../core/storage/db";
import i18n from "../../i18n/config";
import { useUsageStore } from "../usage/usage-store";

const activeControllers = new Set<AbortController>();

export function createActiveTaskController(): {
  signal: AbortSignal;
  dispose(): void;
} {
  const controller = new AbortController();
  activeControllers.add(controller);
  return {
    signal: controller.signal,
    dispose: () => activeControllers.delete(controller),
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
  if (
    provider.protocolId !== "openai-chat-completions" &&
    provider.protocolId !== "openai-compatible-chat" &&
    provider.protocolId !== "anthropic-messages" &&
    provider.protocolId !== "gemini-generate-content" &&
    provider.protocolId !== "openai-responses"
  )
    return "chat.protocolUnsupported";
}

export function stopActiveStream(): void {
  for (const controller of activeControllers) controller.abort();
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
  activeControllers.add(controller);
  let content = "";
  let status: StreamResult["status"] = "complete";
  let errorMessage: string | undefined;
  let completed = false;
  const toolCalls = new Map<string, { id: string; toolName: string; arguments: string }>();
  const startTime = Date.now();
  const batched = batchDeltas(onDelta);

  try {
    for await (const event of configuredAdapter.stream({
      modelId: provider.modelId,
      messages,
      ...(tools?.length ? { tools } : {}),
      signal: controller.signal,
    })) {
      if (event.type === "text-delta") {
        content += event.text;
        batched.schedule(content);
      } else if (event.type === "tool-call-start") {
        toolCalls.set(event.toolCallId, {
          id: event.toolCallId,
          toolName: event.toolName,
          arguments: "",
        });
      } else if (event.type === "tool-call-arguments-delta") {
        const call = toolCalls.get(event.toolCallId);
        if (call) call.arguments += event.argumentsDelta;
      } else if (event.type === "usage") {
        const usageRecord: UsageRecord = {
          id:
            typeof crypto !== "undefined" && crypto.randomUUID
              ? crypto.randomUUID()
              : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
          conversationId,
          providerId: provider.id,
          modelId: provider.modelId,
          ...(event.usage.inputTokens !== undefined
            ? { inputTokens: event.usage.inputTokens }
            : {}),
          ...(event.usage.outputTokens !== undefined
            ? { outputTokens: event.usage.outputTokens }
            : {}),
          ...(event.usage.totalTokens !== undefined
            ? { totalTokens: event.usage.totalTokens }
            : {}),
          evidence: "provider",
          success: true,
          durationMs: Date.now() - startTime,
          ...(content ? { firstTokenMs: Date.now() - startTime } : {}),
          createdAt: Date.now(),
        };
        void useUsageStore.getState().addRecord(usageRecord);
      } else if (event.type === "error") {
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
        break;
      } else if (event.type === "response-complete") {
        completed = true;
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
  } finally {
    if (timeout !== undefined) globalThis.clearTimeout(timeout);
    activeControllers.delete(controller);
    externalSignal?.removeEventListener("abort", abortFromExternal);
    batched.flush(content);
  }

  if (!completed && status === "complete") status = "stopped";
  return {
    content,
    status,
    ...(errorMessage !== undefined ? { errorMessage } : {}),
    ...(toolCalls.size > 0 ? { toolCalls: [...toolCalls.values()] } : {}),
  } satisfies StreamResult;
}
