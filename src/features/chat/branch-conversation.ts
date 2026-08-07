import i18n from "../../i18n/config";
import type {
  ConversationRecord,
  MessageRecord,
  ToolCallRecord,
  ToolResultRecord,
  AttachmentRecord,
} from "../../core/storage/db";
import type { StorageMutation } from "../../core/storage/storage-port";
import { getStructuredStorage } from "../../runtime/structured-storage";

function createBranch(
  source: ConversationRecord,
  branchedFromMessageId: string,
): ConversationRecord {
  const now = Date.now();
  const label = i18n.t("chat.branched");
  return {
    id: crypto.randomUUID(),
    title: `${source.title} ${label}`,
    providerId: source.providerId,
    modelId: source.modelId,
    createdAt: now,
    updatedAt: now,
    parentConversationId: source.id,
    branchedFromMessageId,
  };
}

export async function branchConversation(
  messages: MessageRecord[],
  conversation: ConversationRecord,
  messageId: string,
): Promise<string> {
  const branchPoint = messages.findIndex((m) => m.id === messageId);
  if (branchPoint === -1) throw new Error("Message not found in current conversation");

  const branched = createBranch(conversation, messageId);
  const messagesToCopy = messages.slice(0, branchPoint + 1);

  const storage = getStructuredStorage();
  const mutations: StorageMutation[] = [
    { type: "write", entity: "conversations", id: branched.id, data: branched },
  ];

  for (const msg of messagesToCopy) {
    const newMessageId = crypto.randomUUID();
    const toolCallIdMap = new Map<string, string>();

    // Copy toolCalls with new IDs, building remap map
    const newToolCalls: ToolCallRecord[] | undefined = msg.toolCalls?.map((tc) => {
      const newTcId = crypto.randomUUID();
      toolCallIdMap.set(tc.id, newTcId);
      return { ...tc, id: newTcId };
    });

    // Copy toolResults, remapping toolCallId
    const newToolResults: ToolResultRecord[] | undefined = msg.toolResults?.map((tr) => ({
      ...tr,
      toolCallId: toolCallIdMap.get(tr.toolCallId) ?? tr.toolCallId,
    }));

    // Build new message without attachments (recovered via DB query)
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { attachments: _att, ...msgRest } = msg;
    const newMessage: MessageRecord = {
      ...msgRest,
      id: newMessageId,
      conversationId: branched.id,
      ...(newToolCalls ? { toolCalls: newToolCalls } : {}),
      ...(newToolResults ? { toolResults: newToolResults } : {}),
    };
    mutations.push({ type: "write", entity: "messages", id: newMessage.id, data: newMessage });

    // Copy attachments with new IDs
    const attachments = await storage.query<AttachmentRecord>("attachments", {
      messageId: msg.id,
    });
    if (attachments.length > 0) {
      const newAttachments: AttachmentRecord[] = attachments.map((att) => ({
        ...att,
        id: crypto.randomUUID(),
        messageId: newMessageId,
      }));
      mutations.push(
        ...newAttachments.map((attachment) => ({
          type: "write" as const,
          entity: "attachments" as const,
          id: attachment.id,
          data: attachment,
        })),
      );
    }
  }
  await storage.apply(mutations);

  return branched.id;
}
