<div align="center">

# Evir

**Your model. Your computer. Your agent.**

A clean, local-first, bring-your-own-model AI client and general-purpose desktop agent.

**Connect one tool-capable model and start using Evir Desktop to work with files, code, terminals, and your computer.**

[简体中文](README.md) · [Product Spec](docs/01-product-requirements.md) · [Roadmap](docs/06-development-plan.md) · [Coding Agent Prompt](prompts/coding-agent-master-prompt.md)

</div>

---

## Why Evir

Many AI clients wrap the core experience in accounts, credits, subscriptions, ads, and platform lock-in. Evir takes a different approach:

- **Bring your own model**: connect international and Chinese providers, local models, or custom compatible endpoints.
- **Local-first data**: conversations, runs, memory, Skills, and settings remain on the user's device by default.
- **Explicit capabilities**: streaming, tool calling, vision, and structured output are shown before use.
- **Controlled execution**: desktop actions are permissioned, stoppable, auditable, and reversible.
- **Clean product surface**: no ads, credits, mandatory accounts, or required Evir cloud backend.
- **Lightweight by design**: Tauri 2, lazy-loaded tools, Skills, MCP servers, and sidecars.
- **One model is enough**: no required secondary summarizer, embedding service, Skill, MCP server, or Evir backend.
- **Locally diagnosable**: system-wide redacted logs, audit trails, and user-exported diagnostic bundles without a remote logging backdoor.

## Multiple products, one shared capability core

### Evir Web

A multi-model chat client that can be deployed as static files.

- Bring your own API key, base URL, and model.
- Real streaming, Markdown, attachments, conversations, and local search.
- Internationalization and light, dark, or system themes.
- Ask chat and attachment analysis without Plan, Agent, or system-level computer control.
- Direct browser-to-provider requests with no required Evir backend.

> Some providers do not allow browser CORS requests. Evir Web must detect this and direct the user to Evir Desktop or a browser-compatible endpoint.

### Evir Desktop

A Tauri 2 agent for macOS and Windows.

It adds:

- Workspaces, filesystem access, terminal, and Git.
- Agent loop, plans, context compaction, and memory.
- Approvals, audit logs, diffs, snapshots, and rollback.
- Built-in and user-created Skills.
- MCP server configuration management; live stdio and Streamable HTTP closure is still in development.
- Browser automation and Computer Use in later phases.

### Evir for VS Code

A standalone `.vsix` extension that does not require the Evir Desktop app to stay running.

- BYOM Provider, Base URL, model, and API-key configuration using VS Code SecretStorage.
- Streaming Ask, cancellation, and local conversation persistence.
- Agent file, search, Git, and command tools in trusted local workspaces.
- Per-call approval for writes and execution, plus Diff and rollback for the last file write.
- VS Code Web, Remote SSH/WSL, MCP, Skills, and Desktop conversation sync are not currently supported.

VS Code-compatible editors such as VSCodium, Cursor, and Windsurf may install the same VSIX, but have not yet been validated individually. JetBrains, Zed, and Neovim require separate runtime adapters; see the [VS Code extension and editor roadmap](docs/19-vscode-extension-and-editor-roadmap.md).

### Evir CLI

The standalone `evir` command does not require Evir Desktop to be installed or running.

- `evir configure` saves Provider metadata and places the API key in the OS credential store.
- `evir ask` streams answers; `evir agent --workspace <path>` runs the Agent inside an explicit workspace boundary.
- Desktop and CLI share the default Provider's non-secret profile and OS credential; a change made by either surface is available on the other's next read.
- `EVIR_API_KEY` is a temporary, highest-priority process override and is never written to configuration or logs.

## Model and protocol architecture

Evir separates provider presets, transport protocols, and model capabilities:

```text
Provider Preset
  vendor defaults, regions, endpoints, and auth UI
        ↓
Protocol Adapter
  OpenAI Responses / Chat Completions, Anthropic Messages,
  Gemini, Bedrock, and other native protocols
        ↓
Model Capability
  streaming, tools, vision, structured output, context window
```

Planned protocol coverage includes:

- OpenAI Responses API
- OpenAI Chat Completions API
- Anthropic Messages API
- Google Gemini Interactions / GenerateContent
- Azure OpenAI Responses / Chat Completions
- Amazon Bedrock Converse / ConverseStream
- Native Mistral, Cohere, and Ollama adapters
- Custom OpenAI-compatible and Anthropic-compatible endpoints

See the [Provider and Protocol Matrix](docs/13-provider-and-protocol-matrix.md).

## Ask / Plan / Agent

- **Ask**: chat and analysis without autonomous local access.
- **Plan**: an internal read-only Desktop Agent phase, not a current top-level mode.
- **Agent**: executes tools under the selected permission policy, with pause, cancel, approval, and rollback.

The current Web UI exposes Ask only; Desktop exposes Ask and Agent.

## Skills and MCP

- Skills describe **how to perform a class of tasks**.
- MCP provides **external tools, resources, and prompts**.
- Web supports instruction-only Skills that do not depend on local capabilities.
- Desktop currently supports Skills and MCP configuration; MCP connection, discovery, and runtime calls are still in development.
- Third-party Skill and MCP content is untrusted by default.

### Personalization without weakening safety

- Configure naming, language, response style, and durable work preferences through a simple form.
- Advanced `USER.md`, `PERSONA.md`, `INSTRUCTIONS.md`, and `SOUL.md` editors are not exposed yet.
- Evir core security, permission, tool, and network policies remain protected and cannot be overridden by Skills or custom instructions.
- Personalization supports global, workspace, and conversation scopes and can be disabled instantly.

### Complete everyday foundations

- Optional system notifications for long-run completion, approvals, and failures.
- Local token and usage records that distinguish provider-reported values from estimates.
- Settings list the current application shortcuts; customization, the command palette, and desktop global shortcuts are not exposed yet.
- Bilingual offline help files are included in the repository; the in-app help center and feedback form are not exposed yet.
- Provider setup includes official website, console, documentation, and status links.

## One-model start and safe switching

- After configuring a provider, API key, and model, the user can begin immediately.
- Ask only requires text generation; Desktop Agent requires reliable tool calling.
- In-conversation switching checks context limits, tools, attachments, data destination, and provider-private state.
- Active Agent runs switch only at a safe checkpoint with a structured handoff.
- Automatic cross-provider fallback is off by default.

## Harness and local diagnostics

Evir treats an agent as `Model + Harness`: the model decides, while the Harness manages context, permissions, tools, loop detection, verification, recovery, and observability. Repository documentation, tests, and architecture rules are part of the machine-readable source of truth.

Diagnostics cover providers, streaming, agents, context, tools, MCP, storage, performance, and crashes. Logs are redacted and local by default. Users explicitly export a diagnostic ZIP and may attach it to a GitHub Issue; Evir has no remote log-access backdoor.

## Privacy and storage

Evir does not require a cloud database.

```text
API keys                   → OS secure credential store
Desktop / CLI Providers    → versioned non-secret local config
Simple settings            → local config
Conversations/runs/memory  → embedded local storage
Logs/diffs/snapshots/files → local Artifact store
```

Desktop uses SQLite as the default embedded adapter. It is a local file, not a server process.

## Performance budgets

- Desktop cold start: P50 < 2s, P95 < 4s.
- Idle memory target: <= 150 MB; regression threshold 200 MB.
- Idle CPU target: < 1% long-running average.
- Initial Web JavaScript gzip: <= 350 KiB, with only the 10 shared Skills bundled.
- Desktop frontend resources: <= 15 MiB, including 10 shared and 26 additional Desktop-only Skills.
- Desktop installer excluding optional sidecars: <= 120 MiB, with a 180 MiB regression ceiling.
- Display provider stream deltas within 100 ms of arrival.

These are engineering budgets and must be measured in CI or release validation.

## Project status

Evir is in **Phase S: stability and experience remediation**, not release-ready.

- Web is limited to chat and attachment analysis; it does not expose Agent, Plan, local workspaces, or MCP.
- Desktop defaults to Agent and can switch to Ask; Plan is not a persistent primary mode.
- Local tools, approval, Agent Activity, workspaces, and baseline recovery paths are implemented and automated.
- Web/Desktop Capability UI has E2E, visual, accessibility, theme, language, and narrow-window coverage.
- The native macOS window passed a startup smoke test. Real-provider flows, a native multi-tool task, signed packaging, and Windows remain unverified.

See the [automated quality report](docs/reviews/automated-quality-report.md) and [stability bug register](docs/reviews/stability-bug-register.md).

## Development

### Requirements

- Node.js 20+
- pnpm 9+
- Rust stable
- Tauri 2 platform dependencies

### Commands

```bash
pnpm install
pnpm dev:web
pnpm dev:desktop
pnpm build:web
pnpm build:desktop
pnpm build:desktop:macos:arm64
pnpm build:desktop:macos:x64
pnpm build:desktop:windows:x64 # run on Windows
pnpm build:vscode
pnpm package:vscode
pnpm build:cli
pnpm check
pnpm test:e2e
pnpm test:ui
pnpm test:visual
pnpm test:a11y
pnpm benchmark
```

Production macOS and Windows bundles should be built on their respective operating systems. A stable release tag triggers explicit Apple Silicon (`arm64`) and Intel (`x64`) macOS DMGs plus a Windows x64 MSI, all collected in one release. M1/M2/M3/M4 users choose `arm64`; Intel Mac users choose `x64`. The two macOS packages are not interchangeable.

You can package locally without creating a tag. An Apple Silicon Mac can produce both arm64 and x64 macOS DMGs with the commands above. Build the Windows x64 installer on a Windows machine or Windows CI runner. Artifacts built without local signing credentials are for testing only. See the [development guide](docs/03-development-guide.md#101-本地打包) for Rust target setup, output paths, and the tag release procedure.

## Documentation

- [Product Requirements](docs/01-product-requirements.md)
- [Technical Architecture](docs/02-technical-architecture.md)
- [Development Guide](docs/03-development-guide.md)
- [Design Specification](docs/04-design-specification.md)
- [Engineering Standards](docs/05-engineering-standards.md)
- [Development Plan](docs/06-development-plan.md)
- [Agent Security and Quality](docs/07-agent-security-and-quality.md)
- [Skills and MCP](docs/08-skill-and-mcp.md)
- [Storage, Artifacts, and Recovery](docs/09-storage-artifacts-and-recovery.md)
- [Streaming and Performance](docs/10-streaming-and-performance.md)
- [Providers, Permissions, and Observability](docs/11-provider-permissions-and-observability.md)
- [Product Closure Review](docs/12-product-closure-review.md)
- [Provider and Protocol Matrix](docs/13-provider-and-protocol-matrix.md)
- [Personalization, Notifications, Usage, Shortcuts, Feedback, and Help](docs/14-personalization-notifications-usage-shortcuts-feedback-help.md)
- [Final Experience, Model Switching, and Context](docs/15-final-experience-model-switching-and-context.md)
- [Evir Harness Engineering](docs/16-harness-engineering-for-evir.md)
- [Local Logging and Diagnostics](docs/17-local-logging-and-diagnostics.md)
- [Final Product Review V6](docs/18-final-product-review-v6.md)
- [VS Code Extension and Editor Roadmap](docs/19-vscode-extension-and-editor-roadmap.md)
- [CLI Product and Technical Specification](docs/20-cli-product-and-technical-specification.md)
- [VS Code and CLI Product/UI Review](docs/reviews/vscode-cli-product-ui-review.md)
- [Coding Agent Prompt](prompts/coding-agent-master-prompt.md)

## Repository

```text
git@github.com:z-Zihan/Evir.git
```

## License

The open-source license will be selected before the first public release. All third-party dependencies must be tracked and license-checked.
