# Evir Help

## Quick start

1. Open Settings → Model providers.
2. Choose a provider, protocol, and model, then enter your own API key.
3. Test the connection and return to chat. Web uses Ask; Desktop defaults to Agent and can switch to Ask.
4. Send a message. Streaming can be stopped at any time.

## Ask, Agent, and planning

- Ask: chat and analysis without autonomous local access.
- Plan: an internal read-only phase of Desktop Agent, not a persistent primary mode.
- Agent: may execute tools under the selected permission policy.

Web does not show Agent, Plan, local workspaces, or MCP. On Desktop, workspace context is next to the composer and is not required for ordinary questions.

## Personalization

The current form supports naming, response language, detail, style, and custom instructions. Advanced `USER.md`, `PERSONA.md`, `INSTRUCTIONS.md`, and `SOUL.md` editing is not exposed yet. Personalization cannot override Evir security or permission rules.

## Skills

A Skill describes how to perform a class of tasks. Enable built-in Skills, import a local Skill, or create one with Skill Creator. Review required capabilities before installation.

## MCP (Desktop)

MCP is intended to provide external tools and resources. The current Desktop UI only stores local stdio and remote Streamable HTTP configuration. Saving or enabling a configuration does not mean that Evir has connected or can call tools; connection, discovery, and test-call closure are still in development.

## Permissions and network

File writes, commands, deletion, publishing, and external data transfer have separate risk levels. Network access and uploading local data are distinct permissions.

## Notifications

System notifications are not exposed in the current Settings UI and Evir does not request notification permission on first launch.

## Keyboard shortcuts

Use `Cmd/Ctrl+N` for a new conversation, `Cmd/Ctrl+,` for Settings, `Cmd/Ctrl+/` for shortcut help, and `Esc` to stop generation or close the top dialog. The current list is in Settings; command palette and shortcut customization are not exposed yet.

## Tokens and usage

The Usage page groups tokens, requests, and latency by time, provider, and model. Provider-reported usage is marked as exact; tokenizer-derived usage is marked as estimated.

## Data and privacy

Evir stores data locally by default and keeps API keys in the OS credential store. Private conversations do not persist chat, memory, or usage history, but provider data policies still apply to API requests.

## Troubleshooting

- Correct key but Web cannot connect: check CORS or use Desktop.
- Agent mode unavailable: verify model tool-calling support.
- MCP: this build stores configuration only; “configuration enabled” is not evidence of a live connection.
- Interrupted response: keep the partial output, retry, and check the provider status page.

## Send feedback

There is no in-app feedback form yet. Open the project GitHub Issues page manually and never include API keys, private conversations, or sensitive file content.

## Switching models

Switch immediately while idle. During generation, the new model applies to the next message unless you stop first. During an Agent run, Evir waits for a safe step boundary and creates a structured handoff. Cross-provider switching shows the new data destination.

## Context compaction

When a long conversation approaches the target model's context limit, Evir compacts older conversation and tool noise. User constraints, approvals, active task state, file changes, and verification evidence are preserved. A second summarizer model is not required.

## Logs and diagnostics

Settings → Diagnostics shows redacted in-memory events for the current session and can export JSON. File-backed logs, a log-folder action, temporary verbose mode, and an offline diagnostic ZIP are not implemented yet.
