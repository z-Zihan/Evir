import { configureAdapter, getAdapter } from "../../core/providers/adapter-registry";
import { ProviderErrorType } from "../../core/providers/stream-events";
import {
  db,
  type MessageRecord,
  type ProviderRecord,
  type UsageRecord,
} from "../../core/storage/db";

let activeController: AbortController | undefined;

export function providerReadinessError(provider: ProviderRecord): string | undefined {
  if (!provider.apiKey) return "chat.apiKeyMissing";
  if (
    provider.protocolId !== "openai-chat-completions" &&
    provider.protocolId !== "openai-compatible-chat"
  ) {
    return "chat.adapterUnavailable";
  }
  return getAdapter(provider.protocolId) ? undefined : "chat.adapterUnavailable";
}

function createUsageRecord(
  usage: { inputTokens?: number; outputTokens?: number; totalTokens?: number },
  provider: ProviderRecord,
  conversationId: string,
  startedAt: number,
  firstTokenAt?: number,
): UsageRecord {
  return {
    id: crypto.randomUUID(),
    conversationId,
    providerId: provider.id,
    modelId: provider.modelId,
    ...usage,
    evidence: "provider",
    success: true,
    durationMs: Date.now() - startedAt,
    ...(firstTokenAt ? { firstTokenMs: firstTokenAt - startedAt } : {}),
    createdAt: startedAt,
  };
}

export interface StreamResult {
  content: string;
  status: MessageRecord["status"];
  errorMessage?: string;
}

export async function streamAssistant(
  provider: ProviderRecord,
  conversationId: string,
  messages: Array<{ role: MessageRecord["role"]; content: string }>,
  onContent: (content: string) => void,
): Promise<StreamResult> {
  if (
    provider.protocolId !== "openai-chat-completions" &&
    provider.protocolId !== "openai-compatible-chat"
  ) {
    return { content: "", status: "error", errorMessage: "chat.adapterUnavailable" };
  }
  const adapter = getAdapter(provider.protocolId);
  if (!adapter) return { content: "", status: "error", errorMessage: "chat.adapterUnavailable" };

  activeController = new AbortController();
  const controller = activeController;
  configureAdapter(adapter, {
    providerId: provider.id,
    baseUrl: provider.baseUrl,
    apiKey: provider.apiKey,
  });
  const startedAt = Date.now();
  let content = "";
  let status: MessageRecord["status"] = "complete";
  let errorMessage: string | undefined;
  let completed = false;
  let firstTokenAt: number | undefined;
  let lastCommit = 0;

  try {
    for await (const event of adapter.stream({
      modelId: provider.modelId,
      messages,
      signal: controller.signal,
    })) {
      if (event.type === "text-delta") {
        firstTokenAt ??= Date.now();
        content += event.text;
        if (Date.now() - lastCommit >= 32) {
          lastCommit = Date.now();
          onContent(content);
        }
      } else if (event.type === "usage") {
        await db.usage_records.put(
          createUsageRecord(event.usage, provider, conversationId, startedAt, firstTokenAt),
        );
      } else if (event.type === "error") {
        status =
          controller.signal.aborted || event.error.type === ProviderErrorType.CANCELLED
            ? "stopped"
            : "error";
        errorMessage = status === "error" ? event.error.message : undefined;
        break;
      } else if (event.type === "response-complete") {
        completed = true;
      }
    }
    if (!completed && status === "complete") {
      status = controller.signal.aborted ? "stopped" : "error";
      errorMessage = status === "error" ? "chat.streamEnded" : undefined;
    }
  } catch (error) {
    status = controller.signal.aborted ? "stopped" : "error";
    errorMessage = status === "error" && error instanceof Error ? error.message : undefined;
  } finally {
    if (activeController === controller) activeController = undefined;
  }

  onContent(content);
  return { content, status, ...(errorMessage ? { errorMessage } : {}) };
}

export function stopActiveStream(): void {
  activeController?.abort();
}
