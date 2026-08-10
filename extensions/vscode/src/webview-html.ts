import type * as vscode from "vscode";
import type { Strings } from "./localization";

function nonce(): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  return Array.from(
    { length: 32 },
    () => alphabet[Math.floor(Math.random() * alphabet.length)],
  ).join("");
}

function html(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "'": "&#39;",
      '"': "&quot;",
    };
    return entities[character] ?? character;
  });
}

export function webviewHtml(webview: vscode.Webview, text: Strings): string {
  const token = nonce();
  const labels = JSON.stringify(text).replace(/</g, "\\u003c");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${token}'; script-src 'nonce-${token}';">
  <title>Evir</title>
  <style nonce="${token}">
    :root { color-scheme: light dark; }
    * { box-sizing: border-box; }
    body { margin: 0; color: var(--vscode-foreground); background: var(--vscode-sideBar-background); font: var(--vscode-font-size)/1.55 var(--vscode-font-family); }
    button, input, select, textarea { font: inherit; }
    button { color: var(--vscode-button-foreground); background: var(--vscode-button-background); border: 1px solid transparent; padding: 6px 10px; cursor: pointer; }
    button:hover { background: var(--vscode-button-hoverBackground); }
    button:focus-visible, input:focus-visible, select:focus-visible, textarea:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 1px; }
    button.secondary { color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); }
    button.secondary:hover { background: var(--vscode-button-secondaryHoverBackground); }
    button.ghost { color: var(--vscode-foreground); background: transparent; border-color: var(--vscode-widget-border); }
    button:disabled { cursor: not-allowed; opacity: .55; }
    .shell { min-height: 100vh; display: grid; grid-template-rows: auto 1fr auto; }
    .toolbar { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 8px 10px; border-bottom: 1px solid var(--vscode-sideBarSectionHeader-border); }
    .modes { display: flex; padding: 2px; background: var(--vscode-input-background); }
    .modes button { min-width: 54px; color: var(--vscode-descriptionForeground); background: transparent; padding: 3px 8px; border: 0; }
    .modes button[aria-pressed="true"] { color: var(--vscode-foreground); background: var(--vscode-list-activeSelectionBackground); }
    .icon-button { width: 28px; height: 28px; padding: 0; background: transparent; color: var(--vscode-foreground); border: 1px solid transparent; }
    .icon-button:hover { background: var(--vscode-toolbar-hoverBackground); }
    main { min-height: 0; overflow-y: auto; padding: 12px; }
    .empty { max-width: 28rem; margin: 18vh auto 0; }
    .empty h1 { margin: 0 0 6px; font-size: 15px; font-weight: 600; }
    .empty p { margin: 0 0 14px; color: var(--vscode-descriptionForeground); }
    .examples { display: grid; gap: 6px; }
    .examples button { text-align: left; color: var(--vscode-foreground); background: transparent; border-color: var(--vscode-widget-border); }
    .messages { display: grid; gap: 16px; }
    .message { min-width: 0; }
    .message .role { margin-bottom: 4px; color: var(--vscode-descriptionForeground); font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: .04em; }
    .message.user { border-left: 2px solid var(--vscode-focusBorder); padding-left: 10px; }
    .message pre { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; font: inherit; }
    .composer-wrap { padding: 8px 10px 10px; border-top: 1px solid var(--vscode-sideBarSectionHeader-border); background: var(--vscode-sideBar-background); }
    .mode-warning { display: none; margin: 0 0 6px; color: var(--vscode-descriptionForeground); font-size: 12px; }
    .composer { border: 1px solid var(--vscode-input-border, var(--vscode-widget-border)); background: var(--vscode-input-background); }
    textarea { display: block; width: 100%; min-height: 70px; max-height: 220px; resize: vertical; border: 0; padding: 8px; color: var(--vscode-input-foreground); background: transparent; }
    textarea:focus-visible { outline-offset: -1px; }
    .composer-actions { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 6px; }
    .status { min-height: 18px; color: var(--vscode-descriptionForeground); font-size: 12px; overflow-wrap: anywhere; }
    .status.error { color: var(--vscode-errorForeground); }
    .approval { margin: 0 0 8px; padding: 10px; border: 1px solid var(--vscode-inputValidation-warningBorder); background: var(--vscode-inputValidation-warningBackground); }
    .approval strong { display: block; margin-bottom: 4px; }
    .approval p { margin: 0 0 8px; white-space: pre-wrap; overflow-wrap: anywhere; }
    .approval-actions { display: flex; gap: 6px; }
    dialog { width: min(440px, calc(100vw - 24px)); border: 1px solid var(--vscode-widget-border); padding: 0; color: var(--vscode-foreground); background: var(--vscode-editorWidget-background); }
    dialog::backdrop { background: rgba(0, 0, 0, .35); }
    .dialog-head { padding: 12px 14px; border-bottom: 1px solid var(--vscode-widget-border); font-weight: 600; }
    form { display: grid; gap: 10px; padding: 14px; }
    label { display: grid; gap: 4px; }
    label span { color: var(--vscode-descriptionForeground); font-size: 12px; }
    input, select { width: 100%; min-height: 28px; border: 1px solid var(--vscode-input-border, transparent); padding: 4px 6px; color: var(--vscode-input-foreground); background: var(--vscode-input-background); }
    .check { display: flex; align-items: center; gap: 8px; }
    .check input { width: auto; min-height: auto; }
    .hint { margin: -6px 0 0; color: var(--vscode-descriptionForeground); font-size: 11px; }
    .dialog-actions { display: flex; justify-content: flex-end; gap: 6px; margin-top: 4px; }
    [hidden] { display: none !important; }
  </style>
</head>
<body>
  <div class="shell">
    <header class="toolbar">
      <div class="modes" role="group" aria-label="Mode">
        <button id="ask-mode" type="button" aria-pressed="true">${html(text.ask)}</button>
        <button id="agent-mode" type="button" aria-pressed="false">${html(text.agent)}</button>
      </div>
      <button id="settings" class="icon-button" type="button" aria-label="${html(text.settings)}" title="${html(text.settings)}">⚙</button>
    </header>
    <main id="scroll" tabindex="0" aria-label="Conversation">
      <section id="empty" class="empty">
        <h1>${html(text.emptyTitle)}</h1>
        <p>${html(text.emptyBody)}</p>
        <div class="examples">
          <button type="button" class="example">${html(text.exampleExplain)}</button>
          <button type="button" class="example">${html(text.exampleTests)}</button>
        </div>
      </section>
      <section id="messages" class="messages" aria-live="polite"></section>
    </main>
    <footer class="composer-wrap">
      <div id="approval-root"></div>
      <p id="mode-warning" class="mode-warning"></p>
      <div class="composer">
        <textarea id="prompt" aria-label="${html(text.placeholder)}" placeholder="${html(text.placeholder)}"></textarea>
        <div class="composer-actions">
          <div id="status" class="status" role="status" aria-live="polite"></div>
          <button id="send" type="button">${html(text.send)}</button>
          <button id="stop" class="secondary" type="button" hidden>${html(text.stop)}</button>
        </div>
      </div>
    </footer>
  </div>
  <dialog id="provider-dialog" aria-labelledby="provider-title">
    <div id="provider-title" class="dialog-head">${html(text.configure)}</div>
    <form id="provider-form">
      <label><span>${html(text.protocol)}</span>
        <select id="protocol">
          <option value="openai-compatible-chat">OpenAI-compatible Chat</option>
          <option value="openai-chat-completions">OpenAI Chat Completions</option>
          <option value="openai-responses">OpenAI Responses</option>
          <option value="anthropic-messages">Anthropic Messages</option>
          <option value="gemini-generate-content">Gemini GenerateContent</option>
          <option value="ollama-native">Ollama</option>
        </select>
      </label>
      <label><span>${html(text.baseUrl)}</span><input id="base-url" type="url" required value="https://api.openai.com/v1"></label>
      <label><span>${html(text.model)}</span><input id="model" required autocomplete="off"></label>
      <label><span>${html(text.apiKey)}</span><input id="api-key" type="password" autocomplete="off"></label>
      <p class="hint">${html(text.apiKeyHint)}</p>
      <label class="check"><input id="tool-calling" type="checkbox"><span>${html(text.toolCalling)}</span></label>
      <div class="dialog-actions">
        <button id="test-provider" class="ghost" type="button">${html(text.test)}</button>
        <button id="cancel-config" class="secondary" type="button">${html(text.cancel)}</button>
        <button type="submit">${html(text.save)}</button>
      </div>
    </form>
  </dialog>
  <script nonce="${token}">
    const vscode = acquireVsCodeApi();
    const labels = ${labels};
    const state = { configured: false, config: undefined, hasApiKey: false, messages: [], running: false, mode: "ask", workspaceTrusted: false, workspaceLocal: false, workspaceName: undefined };
    const byId = (id) => document.getElementById(id);
    const prompt = byId("prompt");
    const dialog = byId("provider-dialog");

    function post(message) { vscode.postMessage(message); }
    function setStatus(message, level = "info") {
      const node = byId("status"); node.textContent = message; node.className = level === "error" ? "status error" : "status";
    }
    function renderMessages() {
      const root = byId("messages"); root.replaceChildren();
      byId("empty").hidden = state.messages.length > 0;
      for (const message of state.messages) {
        const article = document.createElement("article"); article.className = "message " + message.role; article.dataset.id = message.id;
        const role = document.createElement("div"); role.className = "role"; role.textContent = message.role === "user" ? "You" : message.role === "tool" ? (message.name || "Tool") : "Evir";
        const content = document.createElement("pre"); content.textContent = message.content;
        article.append(role, content); root.append(article);
      }
      byId("scroll").scrollTop = byId("scroll").scrollHeight;
    }
    function updateModeAvailability() {
      let warning = "";
      if (!state.workspaceName) warning = labels.noWorkspace;
      else if (!state.workspaceTrusted) warning = labels.untrustedWorkspace;
      else if (!state.workspaceLocal) warning = labels.remoteWorkspace;
      else if (!state.config?.toolCalling) warning = labels.noTools;
      const agent = byId("agent-mode"); agent.disabled = Boolean(warning);
      if (state.mode === "agent" && warning) state.mode = "ask";
      byId("ask-mode").setAttribute("aria-pressed", String(state.mode === "ask"));
      agent.setAttribute("aria-pressed", String(state.mode === "agent"));
      const warningNode = byId("mode-warning"); warningNode.textContent = warning || (state.mode === "agent" ? labels.agentDisclosure : ""); warningNode.style.display = warning || state.mode === "agent" || agent.matches(":focus") ? "block" : "none";
    }
    function renderState() {
      renderMessages(); updateModeAvailability();
      byId("send").hidden = state.running; byId("stop").hidden = !state.running; prompt.disabled = state.running;
      if (state.config) {
        byId("protocol").value = state.config.protocolId; byId("base-url").value = state.config.baseUrl; byId("model").value = state.config.modelId; byId("tool-calling").checked = state.config.toolCalling;
      }
      if (!state.configured && !dialog.open) dialog.showModal();
    }
    function openConfig() { if (!dialog.open) { dialog.showModal(); setTimeout(() => byId("protocol").focus(), 0); } }
    function currentConfig() { return { protocolId: byId("protocol").value, baseUrl: byId("base-url").value, modelId: byId("model").value, toolCalling: byId("tool-calling").checked }; }
    function sendPrompt() { const text = prompt.value.trim(); if (!text || state.running) return; post({ type: "send", text, mode: state.mode }); prompt.value = ""; }

    byId("settings").addEventListener("click", openConfig);
    byId("cancel-config").addEventListener("click", () => { if (state.configured) dialog.close(); });
    byId("provider-form").addEventListener("submit", (event) => { event.preventDefault(); post({ type: "configure", config: currentConfig(), apiKey: byId("api-key").value }); });
    byId("test-provider").addEventListener("click", () => { post({ type: "test-provider", config: currentConfig(), apiKey: byId("api-key").value }); });
    byId("ask-mode").addEventListener("click", () => { state.mode = "ask"; updateModeAvailability(); });
    byId("agent-mode").addEventListener("click", () => { if (!byId("agent-mode").disabled) { state.mode = "agent"; updateModeAvailability(); } });
    byId("send").addEventListener("click", sendPrompt); byId("stop").addEventListener("click", () => post({ type: "stop" }));
    prompt.addEventListener("keydown", (event) => { if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) { event.preventDefault(); sendPrompt(); } });
    for (const button of document.querySelectorAll(".example")) button.addEventListener("click", () => { prompt.value = button.textContent || ""; prompt.focus(); });
    window.addEventListener("message", ({ data }) => {
      if (data.type === "state") { Object.assign(state, data); renderState(); }
      if (data.type === "stream-start") { state.running = true; state.messages.push({ id: data.messageId, role: "assistant", content: "", createdAt: Date.now() }); renderState(); }
      if (data.type === "stream-delta") { const message = state.messages.find((item) => item.id === data.messageId); if (message) message.content = data.content; renderMessages(); }
      if (data.type === "stream-end") { state.running = false; renderState(); }
      if (data.type === "notice") { setStatus(data.message, data.level); if (data.level !== "error" && dialog.open && data.message === labels.configured) dialog.close(); }
      if (data.type === "open-config") openConfig();
      if (data.type === "approval") {
        const root = byId("approval-root"); const box = document.createElement("section"); box.className = "approval";
        const title = document.createElement("strong"); title.textContent = labels.approval + ": " + data.title;
        const detail = document.createElement("p"); detail.textContent = data.detail;
        const actions = document.createElement("div"); actions.className = "approval-actions";
        const deny = document.createElement("button"); deny.type = "button"; deny.className = "secondary"; deny.textContent = labels.deny;
        const approve = document.createElement("button"); approve.type = "button"; approve.textContent = labels.approve;
        deny.addEventListener("click", () => { post({ type: "deny", requestId: data.requestId }); box.remove(); });
        approve.addEventListener("click", () => { post({ type: "approve", requestId: data.requestId }); box.remove(); });
        actions.append(deny, approve); box.append(title, detail, actions); root.replaceChildren(box); deny.focus();
      }
    });
    post({ type: "ready" });
  </script>
</body>
</html>`;
}
