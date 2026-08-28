# Evir Help

## Quick start

1. Open Settings → Model providers.
2. Choose a provider, protocol, and model, then enter your own API key.
3. Test the connection and return to the main view. Web uses Ask; Desktop starts from the sidebar.
4. Send a message. Streaming can be stopped at any time.

## Sidebar: Projects and Chats

The Desktop sidebar has two sections:

- **PROJECTS**: a project maps to one local folder. Create a task (thread) inside a project and the Agent's working directory is the project root — no workspace picker required. Projects support pin, rename, sort, and search. If the folder is moved or renamed, the project shows a "Folder not found" badge; re-locate it and your history and permissions are preserved.
- **CHATS**: standalone conversations for pure chat and analysis. They never touch local files.

## Ask, Plan, Goal, and Agent

- Ask: chat and analysis without autonomous local access (standalone chats are always Ask).
- Plan: a first-class mode in project threads. It inspects files and Git status with read-only tools, produces a plan, and offers one-click "Execute Plan" to continue as Agent.
- Goal: a first-class mode for long-running objectives with optional done-when conditions; Evir verifies each condition with real evidence before claiming success.
- Agent: executes tools under the selected permission policy.

Mode controls sit in the compact bar above the composer in project threads; they are disabled with guidance when the model lacks tool calling. Web does not show projects, Agent, Plan, Goal, or MCP.

## Project permissions

Each project picks its own permission level:

- **Ask for Approval** (default): writes and commands inside the project require per-call approval; reads are automatic.
- **Workspace Access**: routine writes and commands inside the project run automatically and are recorded in the audit log.
- **Full Access**: removes the directory boundary; first activation always requires an explicit confirmation dialog.

Projects can also declare additional access roots beyond the project folder.

## Personalization

The current form supports naming, response language, detail, style, and custom instructions. Advanced `USER.md`, `PERSONA.md`, `INSTRUCTIONS.md`, and `SOUL.md` editing is not exposed yet. Personalization cannot override Evir security or permission rules.

## Skills

A Skill describes how to perform a class of tasks. Enable built-in Skills, import a local Skill, or create one with Skill Creator. Review required capabilities before installation.

## MCP (Desktop)

MCP provides external tools and resources. Desktop supports local stdio and remote Streamable HTTP servers: save and enable a server in Settings → MCP and Evir performs a real connection and tool discovery. New servers are disabled by default and tool calls remain under the permission system. Connection failures are surfaced explicitly instead of pretending to be connected.

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
- MCP: check the configuration page for connection errors; tools are callable only after a successful connection.
- Interrupted response: keep the partial output, retry, and check the provider status page.

## Send feedback

There is no in-app feedback form yet. Open the project GitHub Issues page manually and never include API keys, private conversations, or sensitive file content.

## Switching models

Switch immediately while idle. During generation, the new model applies to the next message unless you stop first. During an Agent run, Evir waits for a safe step boundary and creates a structured handoff; a running task stays bound to the project it started in, even if you switch projects in the sidebar. Cross-provider switching shows the new data destination.

## Context compaction

When a long conversation approaches the target model's context limit, Evir compacts older conversation and tool noise. User constraints, approvals, active task state, file changes, and verification evidence are preserved. A second summarizer model is not required.

## Logs and diagnostics

Settings → Diagnostics shows redacted events and exports JSON on every surface. Desktop additionally persists categorized log files locally and supports **Export diagnostics bundle (ZIP)**: it previews the file count and size first, then saves redacted system/provider/MCP metadata plus local logs. Secrets and conversation bodies are never included. Bundles leave your machine only if you send them yourself — Evir has no remote log access.
