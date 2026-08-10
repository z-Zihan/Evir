import * as vscode from "vscode";
import { AgentRunner, type ApprovalRequest } from "./agent-runner";
import { ChangeTracker } from "./change-tracker";
import { ConversationStore } from "./conversation-store";
import { strings } from "./localization";
import { ProviderClient } from "./provider-client";
import { ProviderStore } from "./provider-store";
import type { ConversationMode, HostMessage, ProviderConfig } from "./types";
import { webviewMessageSchema } from "./types";
import { webviewHtml } from "./webview-html";
import { WorkspaceTools } from "./workspace-tools";

export class EvirViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  static readonly viewId = "evir.chatView";
  private readonly providerStore: ProviderStore;
  private readonly conversationStore: ConversationStore;
  private readonly providerClient = new ProviderClient();
  private readonly changes: ChangeTracker;
  private readonly agentRunner: AgentRunner;
  private readonly disposables: vscode.Disposable[] = [];
  private readonly approvals = new Map<string, (approved: boolean) => void>();
  private view: vscode.WebviewView | undefined;
  private controller: AbortController | undefined;

  constructor(private readonly context: vscode.ExtensionContext) {
    this.providerStore = new ProviderStore(context);
    this.conversationStore = new ConversationStore(context);
    this.changes = new ChangeTracker(context);
    this.agentRunner = new AgentRunner(this.providerClient, new WorkspaceTools(this.changes));
    this.disposables.push(
      vscode.workspace.onDidGrantWorkspaceTrust(() => void this.sendState()),
      vscode.workspace.onDidChangeWorkspaceFolders(() => void this.sendState()),
    );
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = { enableScripts: true };
    view.webview.html = webviewHtml(view.webview, strings());
    this.disposables.push(
      view.webview.onDidReceiveMessage((raw: unknown) => void this.handleMessage(raw)),
      view.onDidDispose(() => {
        if (this.view === view) {
          this.view = undefined;
          this.stop();
        }
      }),
    );
  }

  async reveal(): Promise<void> {
    await vscode.commands.executeCommand("workbench.view.extension.evir");
  }

  async openConfiguration(): Promise<void> {
    await this.reveal();
    await this.post({ type: "open-config" });
  }

  async newConversation(): Promise<void> {
    this.stop();
    await this.conversationStore.clear();
    await this.sendState();
  }

  stop(): void {
    this.controller?.abort();
    for (const resolve of this.approvals.values()) resolve(false);
    this.approvals.clear();
  }

  showLastDiff(): Promise<void> {
    return this.changes.showDiff();
  }

  revertLastChange(): Promise<void> {
    return this.changes.revert();
  }

  dispose(): void {
    this.stop();
    for (const disposable of this.disposables) disposable.dispose();
  }

  private async handleMessage(raw: unknown): Promise<void> {
    const text = strings();
    const parsed = webviewMessageSchema.safeParse(raw);
    if (!parsed.success) {
      await this.notice("error", text.invalidMessage);
      return;
    }

    try {
      const message = parsed.data;
      if (message.type === "ready") await this.sendState();
      if (message.type === "configure") {
        await this.providerStore.save(message.config, message.apiKey);
        await this.notice("info", text.configured);
        await this.sendState();
      }
      if (message.type === "test-provider") {
        await this.testProvider(message.config, message.apiKey);
      }
      if (message.type === "send") await this.send(message.text, message.mode);
      if (message.type === "stop") this.stop();
      if (message.type === "new-conversation") await this.newConversation();
      if (message.type === "approve" || message.type === "deny") {
        const resolve = this.approvals.get(message.requestId);
        if (resolve) {
          this.approvals.delete(message.requestId);
          resolve(message.type === "approve");
        }
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : text.unexpectedError;
      await this.notice("error", detail);
    }
  }

  private async testProvider(config: ProviderConfig, apiKeyInput: string): Promise<void> {
    const text = strings();
    const savedKey = await this.providerStore.getApiKey();
    const apiKey =
      apiKeyInput.trim() || savedKey || (config.protocolId === "ollama-native" ? "local" : "");
    if (!apiKey) {
      await this.notice("error", text.missingProvider);
      return;
    }
    await this.notice("info", text.testing);
    const result = await this.providerClient.test(config, apiKey);
    await this.notice(
      result.ok ? "info" : "error",
      result.ok ? text.testPassed : `${text.testFailed}: ${result.error ?? "Unknown error"}`,
    );
  }

  private async send(input: string, mode: ConversationMode): Promise<void> {
    const text = strings();
    if (this.controller) return;
    const credentials = await this.credentials();
    if (!credentials) {
      await this.notice("error", text.missingProvider);
      await this.openConfiguration();
      return;
    }
    if (mode === "agent" && !this.agentAvailable(credentials.config)) {
      await this.notice("warning", text.noWorkspace);
      return;
    }

    const userMessage = {
      id: crypto.randomUUID(),
      role: "user" as const,
      content: input,
      createdAt: Date.now(),
    };
    await this.conversationStore.append(userMessage);
    await this.sendState(mode);

    const assistantId = crypto.randomUUID();
    const controller = new AbortController();
    this.controller = controller;
    await vscode.commands.executeCommand("setContext", "evir.isRunning", true);
    await this.post({ type: "stream-start", messageId: assistantId });
    const history = this.conversationStore.list().map(({ role, content }) => ({ role, content }));
    const onDelta = (content: string) =>
      void this.post({ type: "stream-delta", messageId: assistantId, content });
    try {
      const result =
        mode === "agent"
          ? await this.agentRunner.run({
              config: credentials.config,
              apiKey: credentials.apiKey,
              history,
              workspaceNames: (vscode.workspace.workspaceFolders ?? []).map(
                (folder) => folder.name,
              ),
              signal: controller.signal,
              onDelta,
              requestApproval: (request) => this.requestApproval(request, controller.signal),
            })
          : await this.providerClient.stream(
              credentials.config,
              credentials.apiKey,
              history,
              undefined,
              controller.signal,
              onDelta,
            );
      const status =
        controller.signal.aborted || result.stopped
          ? "stopped"
          : result.error
            ? "error"
            : "complete";
      const finalContent = result.content || (result.error ? `Error: ${result.error}` : "");
      await this.post({ type: "stream-delta", messageId: assistantId, content: finalContent });
      await this.conversationStore.append({
        id: assistantId,
        role: "assistant",
        content: finalContent,
        createdAt: Date.now(),
      });
      await this.post({ type: "stream-end", messageId: assistantId, status });
      if (result.error && !controller.signal.aborted) await this.notice("error", result.error);
      if (controller.signal.aborted) await this.notice("info", text.stopped);
    } catch (error) {
      const stopped = controller.signal.aborted;
      await this.post({
        type: "stream-end",
        messageId: assistantId,
        status: stopped ? "stopped" : "error",
      });
      if (stopped) await this.notice("info", text.stopped);
      else throw error;
    } finally {
      if (this.controller === controller) this.controller = undefined;
      await vscode.commands.executeCommand("setContext", "evir.isRunning", false);
    }
  }

  private agentAvailable(config: ProviderConfig): boolean {
    const folders = vscode.workspace.workspaceFolders ?? [];
    return (
      config.toolCalling &&
      vscode.workspace.isTrusted &&
      folders.length > 0 &&
      folders.every((folder) => folder.uri.scheme === "file")
    );
  }

  private requestApproval(request: ApprovalRequest, signal: AbortSignal): Promise<boolean> {
    if (signal.aborted) return Promise.resolve(false);
    const requestId = crypto.randomUUID();
    return new Promise((resolve) => {
      const finish = (approved: boolean) => {
        signal.removeEventListener("abort", stop);
        resolve(approved);
      };
      const stop = () => {
        this.approvals.delete(requestId);
        finish(false);
      };
      this.approvals.set(requestId, finish);
      signal.addEventListener("abort", stop, { once: true });
      void this.post({ type: "approval", requestId, ...request });
    });
  }

  private async credentials(): Promise<{ config: ProviderConfig; apiKey: string } | undefined> {
    const config = this.providerStore.getConfig();
    const apiKey = await this.providerStore.getApiKey();
    if (!config) return undefined;
    if (!apiKey && config.protocolId !== "ollama-native") return undefined;
    return { config, apiKey: apiKey ?? "local" };
  }

  private async sendState(mode?: ConversationMode): Promise<void> {
    const config = this.providerStore.getConfig();
    const apiKey = await this.providerStore.getApiKey();
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    const configured = Boolean(config && (apiKey || config.protocolId === "ollama-native"));
    const defaultMode = vscode.workspace
      .getConfiguration("evir")
      .get<ConversationMode>("defaultMode", "ask");
    await this.post({
      type: "state",
      configured,
      ...(config ? { config } : {}),
      hasApiKey: Boolean(apiKey),
      messages: [...this.conversationStore.list()],
      running: Boolean(this.controller),
      ...(workspaceFolder ? { workspaceName: workspaceFolder.name } : {}),
      workspaceTrusted: vscode.workspace.isTrusted,
      workspaceLocal: Boolean(
        vscode.workspace.workspaceFolders?.every((folder) => folder.uri.scheme === "file"),
      ),
      mode: mode ?? defaultMode,
    });
  }

  private notice(level: "info" | "warning" | "error", message: string): Thenable<boolean> {
    return this.post({ type: "notice", level, message });
  }

  private post(message: HostMessage): Thenable<boolean> {
    return this.view?.webview.postMessage(message) ?? Promise.resolve(false);
  }
}
