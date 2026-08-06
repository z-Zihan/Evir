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

Use the simple form for naming, language, response style, and durable preferences. Advanced mode supports `USER.md`, `PERSONA.md`, `INSTRUCTIONS.md`, and `SOUL.md`. These documents cannot override Evir security or permission rules.

## Skills

A Skill describes how to perform a class of tasks. Enable built-in Skills, import a local Skill, or create one with Skill Creator. Review required capabilities before installation.

## MCP (Desktop)

MCP provides external tools and resources. Desktop supports local stdio and remote Streamable HTTP servers. Test the connection and inspect exposed tools before enabling a server.

## Permissions and network

File writes, commands, deletion, publishing, and external data transfer have separate risk levels. Network access and uploading local data are distinct permissions.

## Notifications

System notifications are off by default. When enabled, Evir can notify you when long tasks finish, require approval, or fail. Sensitive previews are disabled by default.

## Keyboard shortcuts

Use `Cmd/Ctrl+K` for the command palette, `Cmd/Ctrl+N` for a new conversation, `Cmd/Ctrl+,` for Settings, and `Esc` to stop generation or close the top dialog. Customize shortcuts in Settings.

## Tokens and usage

The Usage page groups tokens, requests, and latency by time, provider, and model. Provider-reported usage is marked as exact; tokenizer-derived usage is marked as estimated.

## Data and privacy

Evir stores data locally by default and keeps API keys in the OS credential store. Private conversations do not persist chat, memory, or usage history, but provider data policies still apply to API requests.

## Troubleshooting

- Correct key but Web cannot connect: check CORS or use Desktop.
- Agent mode unavailable: verify model tool-calling support.
- MCP connection failure: inspect command, working directory, authentication, logs, and ports.
- Interrupted response: keep the partial output, retry, and check the provider status page.

## Send feedback

Use Settings → Send feedback, preview the content, and open a GitHub Issue. Never include API keys, private conversations, or sensitive file content.

## Switching models

Switch immediately while idle. During generation, the new model applies to the next message unless you stop first. During an Agent run, Evir waits for a safe step boundary and creates a structured handoff. Cross-provider switching shows the new data destination.

## Context compaction

When a long conversation approaches the target model's context limit, Evir compacts older conversation and tool noise. User constraints, approvals, active task state, file changes, and verification evidence are preserved. A second summarizer model is not required.

## Logs and diagnostics

Use Settings → Data & Privacy / About Evir to open the log folder, enable temporary verbose logging, or export a diagnostic bundle. Logs are redacted and local by default. Preview the bundle before attaching it to a GitHub Issue.
