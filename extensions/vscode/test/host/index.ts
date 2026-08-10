import assert from "node:assert/strict";
import * as vscode from "vscode";

export async function run(): Promise<void> {
  const extension = vscode.extensions.getExtension("evir.evir");
  assert.ok(extension, "The Evir extension should be discoverable by its manifest ID");
  await extension.activate();
  assert.equal(extension.isActive, true, "The Evir extension should activate successfully");

  const commands = await vscode.commands.getCommands(true);
  for (const command of [
    "evir.open",
    "evir.configureProvider",
    "evir.newConversation",
    "evir.stop",
    "evir.showLastDiff",
    "evir.revertLastChange",
  ]) {
    assert.ok(commands.includes(command), `Expected registered command: ${command}`);
  }

  await vscode.commands.executeCommand("evir.newConversation");
  await vscode.commands.executeCommand("evir.open");
}
