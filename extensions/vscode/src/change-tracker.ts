import { createHash } from "node:crypto";
import * as vscode from "vscode";
import { z } from "zod";

const CHANGE_KEY = "evir.workspace.lastChange";
const changeSchema = z.object({
  target: z.string(),
  snapshot: z.string(),
  existed: z.boolean(),
  afterHash: z.string(),
});
type StoredChange = z.infer<typeof changeSchema>;

function hash(content: Uint8Array<ArrayBufferLike>): string {
  return createHash("sha256").update(content).digest("hex");
}

export class ChangeTracker {
  constructor(private readonly context: vscode.ExtensionContext) {}

  async record(
    target: vscode.Uri,
    before: Uint8Array<ArrayBufferLike>,
    existed: boolean,
    after: Uint8Array<ArrayBufferLike>,
  ) {
    await vscode.workspace.fs.createDirectory(this.context.globalStorageUri);
    const snapshot = vscode.Uri.joinPath(this.context.globalStorageUri, "last-change-before.txt");
    await vscode.workspace.fs.writeFile(snapshot, before);
    const change: StoredChange = {
      target: target.toString(),
      snapshot: snapshot.toString(),
      existed,
      afterHash: hash(after),
    };
    await this.context.workspaceState.update(CHANGE_KEY, change);
  }

  async showDiff(): Promise<void> {
    const change = this.get();
    if (!change) {
      void vscode.window.showInformationMessage("Evir has no recorded workspace change.");
      return;
    }
    const target = vscode.Uri.parse(change.target);
    await vscode.commands.executeCommand(
      "vscode.diff",
      vscode.Uri.parse(change.snapshot),
      target,
      `Evir change: ${vscode.workspace.asRelativePath(target)}`,
    );
  }

  async revert(): Promise<void> {
    const change = this.get();
    if (!change) {
      void vscode.window.showInformationMessage("Evir has no recorded workspace change.");
      return;
    }
    const target = vscode.Uri.parse(change.target);
    let current: Uint8Array<ArrayBufferLike>;
    try {
      current = await vscode.workspace.fs.readFile(target);
    } catch {
      current = new Uint8Array();
    }
    if (hash(current) !== change.afterHash) {
      const choice = await vscode.window.showWarningMessage(
        "The file changed after Evir wrote it. Reverting may discard newer work.",
        { modal: true },
        "Revert anyway",
      );
      if (choice !== "Revert anyway") return;
    }
    if (change.existed) {
      const snapshot = await vscode.workspace.fs.readFile(vscode.Uri.parse(change.snapshot));
      await vscode.workspace.fs.writeFile(target, snapshot);
    } else {
      await vscode.workspace.fs.delete(target, { useTrash: true });
    }
    await this.context.workspaceState.update(CHANGE_KEY, undefined);
    void vscode.window.showInformationMessage("Evir reverted the last recorded change.");
  }

  private get(): StoredChange | undefined {
    const parsed = changeSchema.safeParse(this.context.workspaceState.get(CHANGE_KEY));
    return parsed.success ? parsed.data : undefined;
  }
}
