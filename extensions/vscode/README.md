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

The Tool Calling checkbox is currently a user declaration, not a capability probe. Agent step/tool/verification activity and complete localization of role/accessibility labels are still release gaps; see the product/UI review below. Building a VSIX does not mean the extension is Marketplace-ready.

## Build a VSIX

From the Evir repository root:

```bash
pnpm install
pnpm package:vscode
```

The package is written to `extensions/vscode/artifacts/evir.vsix`.

## Verify

```bash
pnpm --dir extensions/vscode check
pnpm --dir extensions/vscode test:host
node extensions/vscode/scripts/visual-qa.mjs
EVIR_QA_THEME=light node extensions/vscode/scripts/visual-qa.mjs
```

Visual QA runs in an isolated VS Code profile and must use temporary credentials only. Public release additionally requires High Contrast, screen-reader, Marketplace/Open VSX installation, upgrade, uninstall, privacy, publisher, and license review.

## Product and architecture

- [VS Code extension and editor roadmap](../../docs/19-vscode-extension-and-editor-roadmap.md)
- [Product requirements](../../docs/01-product-requirements.md)
- [Technical architecture](../../docs/02-technical-architecture.md)
- [VS Code and CLI product/UI review](../../docs/reviews/vscode-cli-product-ui-review.md)
