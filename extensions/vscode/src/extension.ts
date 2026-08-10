import * as vscode from "vscode";
import { EvirViewProvider } from "./evir-view-provider";

export function activate(context: vscode.ExtensionContext): void {
  const provider = new EvirViewProvider(context);
  context.subscriptions.push(
    provider,
    vscode.window.registerWebviewViewProvider(EvirViewProvider.viewId, provider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.commands.registerCommand("evir.open", () => provider.reveal()),
    vscode.commands.registerCommand("evir.configureProvider", () => provider.openConfiguration()),
    vscode.commands.registerCommand("evir.newConversation", () => provider.newConversation()),
    vscode.commands.registerCommand("evir.stop", () => provider.stop()),
    vscode.commands.registerCommand("evir.showLastDiff", () => provider.showLastDiff()),
    vscode.commands.registerCommand("evir.revertLastChange", () => provider.revertLastChange()),
  );
  void vscode.commands.executeCommand("setContext", "evir.isRunning", false);
}

export function deactivate(): void {}
