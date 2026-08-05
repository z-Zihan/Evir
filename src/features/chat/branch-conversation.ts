import i18n from "../../i18n/config";
import {
  db,
  type ConversationRecord,
  type MessageRecord,
  type ToolCallRecord,
  type ToolResultRecord,
  type AttachmentRecord,
} from "../../core/storage/db";

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

  await db.transaction("rw", db.conversations, db.messages, db.attachments, async () => {
    await db.conversations.add(branched);

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
      await db.messages.add(newMessage);

      // Copy attachments with new IDs
      const attachments = await db.attachments.where("messageId").equals(msg.id).toArray();
      if (attachments.length > 0) {
        const newAttachments: AttachmentRecord[] = attachments.map((att) => ({
          ...att,
          id: crypto.randomUUID(),
          messageId: newMessageId,
        }));
        await db.attachments.bulkAdd(newAttachments);
      }
    }
  });

  return branched.id;
}
