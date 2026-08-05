import {
  db,
  createBranch,
  type ConversationRecord,
  type MessageRecord,
} from "../../core/storage/db";

export async function branchConversation(
  currentConversationId: string,
  messages: MessageRecord[],
  conversation: ConversationRecord,
  messageId: string,
): Promise<string> {
  const branchPoint = messages.findIndex((m) => m.id === messageId);
  if (branchPoint === -1) throw new Error("Message not found in current conversation");

  const branched = createBranch(conversation, messageId);
  const messagesToCopy = messages.slice(0, branchPoint + 1);
  const idMap = new Map<string, string>();

  await db.transaction("rw", db.conversations, db.messages, db.attachments, async () => {
    await db.conversations.add(branched);

    for (const msg of messagesToCopy) {
      const newMessageId = crypto.randomUUID();
      idMap.set(msg.id, newMessageId);

      const { attachments: _a, toolCalls: _t, toolResults: _r, ...msgRest } = msg;
      void _a; void _t; void _r;
      const newMessage: MessageRecord = {
        ...msgRest,
        id: newMessageId,
        conversationId: branched.id,
      };
      await db.messages.add(newMessage);

      const attachments = await db.attachments.where("messageId").equals(msg.id).toArray();
      for (const att of attachments) {
        await db.attachments.add({
          ...att,
          id: crypto.randomUUID(),
          messageId: newMessageId,
        });
      }
    }
  });

  return branched.id;
}
