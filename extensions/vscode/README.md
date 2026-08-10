# Evir for Visual Studio Code

Evir is a local-first, bring-your-own-model assistant and workspace agent. It does not require an Evir account, credits, or an Evir cloud backend.

## First run

1. Open the Evir view from the Activity Bar.
2. Choose a protocol, Base URL, model ID, and API key.
3. Test the connection and save.
4. Use **Ask** for conversation without autonomous workspace access.
5. Use **Agent** in a trusted local workspace with a tool-capable model.

API keys are stored with VS Code `SecretStorage`. Provider metadata and conversation history remain in VS Code local extension storage.

## Agent safety

- Agent is unavailable without Workspace Trust.
- File access is limited to opened local workspace folders, including symbolic-link boundary checks.
- File writes and command execution require explicit per-call approval.
- Commands use a program plus argument array; shell interpolation is disabled.
- The last file write has a local snapshot. Use **Evir: Show Last Change** or **Evir: Revert Last Change** from the Command Palette.
- Stopping a task aborts the model request, pending approval, and active child process.

Workspace content read by Agent may be sent to the model Provider configured by the user. Evir does not silently switch Providers.

## Current scope

The first extension release supports OpenAI Chat Completions, OpenAI-compatible Chat, OpenAI Responses, Anthropic Messages, Gemini GenerateContent, and Ollama configurations. It includes streaming Ask, workspace Agent tools, approvals, Git status/diff, command execution, cancellation, and last-write rollback.

VS Code Web, remote workspaces, Desktop conversation synchronization, MCP, Skills, browser automation, and inline completion are not currently supported by the extension.

## Build a VSIX

From the Evir repository root:

```bash
pnpm install
pnpm package:vscode
```

The package is written to `extensions/vscode/artifacts/evir.vsix`.
