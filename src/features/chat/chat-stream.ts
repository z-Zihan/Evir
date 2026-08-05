import { createConfiguredAdapter } from "../../core/providers/adapter-registry";
import { getErrorDisplay } from "../../core/providers/error-messages";
import { ProviderErrorType } from "../../core/providers/stream-events";
import type { ProviderRecord, UsageRecord } from "../../core/storage/db";
import { useUsageStore } from "../usage/usage-store";

let activeController: AbortController | undefined;

async function formatProviderError(
  errorType: ProviderErrorType,
  providerMessage: string,
): Promise<string> {
  const { default: i18n } = await import("../../i18n/config");
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
    provider.protocolId !== "anthropic-messages"
  )
    return "chat.protocolUnsupported";
}

export function stopActiveStream(): void {
  activeController?.abort();
}

export interface StreamResult {
  content: string;
  status: "complete" | "stopped" | "error";
  errorMessage?: string;
}

export async function streamAssistant(
  provider: ProviderRecord,
  conversationId: string,
  messages: { role: string; content: string }[],
  onDelta: (delta: string) => void,
): Promise<StreamResult> {
  if (activeController) {
    return {
      content: "",
      status: "error",
      errorMessage: "chat.alreadyStreaming",
    } satisfies StreamResult;
  }
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
  activeController = controller;
  let content = "";
  let status: StreamResult["status"] = "complete";
  let errorMessage: string | undefined;
  let completed = false;
  const startTime = Date.now();

  try {
    for await (const event of configuredAdapter.stream({
      modelId: provider.modelId,
      messages,
      signal: controller.signal,
    })) {
      if (event.type === "text-delta") {
        content += event.text;
        onDelta(content);
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
        status =
          controller.signal.aborted || event.error.type === ProviderErrorType.CANCELLED
            ? "stopped"
            : "error";
        errorMessage =
          status === "error"
            ? await formatProviderError(event.error.type, event.error.message)
            : undefined;
        break;
      } else if (event.type === "response-complete") {
        completed = true;
      }
    }
  } catch (error) {
    status = controller.signal.aborted ? "stopped" : "error";
    errorMessage =
      status === "error"
        ? await formatProviderError(
            ProviderErrorType.PROVIDER_ERROR,
            error instanceof Error ? error.message : "",
          )
        : undefined;
  } finally {
    if (activeController === controller) activeController = undefined;
  }

  if (!completed && status === "complete") status = "stopped";
  return {
    content,
    status,
    ...(errorMessage !== undefined ? { errorMessage } : {}),
  } satisfies StreamResult;
}
