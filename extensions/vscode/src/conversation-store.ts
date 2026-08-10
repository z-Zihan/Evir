import type * as vscode from "vscode";
import { z } from "zod";
import type { ConversationMessage } from "./types";

const STORAGE_KEY = "evir.conversation.messages";
const messageSchema = z.object({
  id: z.string(),
  role: z.enum(["user", "assistant", "tool"]),
  content: z.string(),
  createdAt: z.number(),
  toolCallId: z.string().optional(),
  name: z.string().optional(),
});

export class ConversationStore {
  private messages: ConversationMessage[];

  constructor(private readonly context: vscode.ExtensionContext) {
    const parsed = z.array(messageSchema).safeParse(context.workspaceState.get(STORAGE_KEY));
    this.messages = parsed.success ? parsed.data : [];
  }

  list(): readonly ConversationMessage[] {
    return this.messages;
  }

  async append(message: ConversationMessage): Promise<void> {
    this.messages = [...this.messages, message].slice(-100);
    await this.context.workspaceState.update(STORAGE_KEY, this.messages);
  }

  async replace(id: string, content: string): Promise<void> {
    this.messages = this.messages.map((message) =>
      message.id === id ? { ...message, content } : message,
    );
    await this.context.workspaceState.update(STORAGE_KEY, this.messages);
  }

  async clear(): Promise<void> {
    this.messages = [];
    await this.context.workspaceState.update(STORAGE_KEY, undefined);
  }
}
