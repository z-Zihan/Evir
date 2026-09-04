<div align="center">

# Evir

**Your model. Your computer. Your agent.**

A clean, local-first, bring-your-own-model **Desktop Project Agent**: open a project, tell Evir what to get done, and it safely reads, edits, runs, and verifies — while showing you exactly what it did, what it changed, where it failed, and whether it truly finished.

**Connect one tool-capable model and start working** — no accounts, no credits, no cloud backend.

[简体中文](README.md) · [Product Spec](docs/01-product-requirements.md) · [Development Guide](docs/03-development-guide.md)

</div>

---

![Evir Desktop: Projects and Chats in the sidebar, an agent run timeline inside a project thread](assets/readme/desktop-overview.png)

## Desktop Project Agent (the primary product)

The Desktop sidebar has two sections: **PROJECTS** and **CHATS**. A project maps to one local folder — create a task inside it and the agent's working directory is the project root. A project thread is a **workbench**, not a chat window:

- **Task stream** — your instructions, every tool step, approval cards, and result summaries in work order; each file mutation renders `path +diffstat` inline and opens the diff in one click.
- **Context Workbench (right panel)** — Outputs / Changes / Files / Preview / Browser. When the agent edits code the panel auto-switches to **Changes** (if you're watching preview/browser it only adds a badge — never steals focus); per-file diffstat, copy-patch, and rollback included.
- **Steerable** — Stop any time while running; queue the next instruction (auto-sent when the run settles); the header always shows the run phase (preparing / streaming / verifying / waiting-approval).

```text
Create a project (pick a folder) → new task → pick Permission / Model
→ agent reads · edits · executes · verifies → diff / snapshot / rollback
```

- **Default project task**: plain questions get plain answers; when the task needs the project, the agent uses 13 built-in tools (read/write/search/patch/command/git/snapshot) plus MCP tools under the permission policy, with pause, approval, and rollback. Plan / Goal are reachable via `/plan` and `/goal`.
- **Plan**: read-only inspection producing a structured plan, then one-click **Execute Plan** continues as the agent.
- **Goal**: long-running objectives with explicit done-when conditions; Evir verifies each condition with real evidence — the model saying "done" is not done.

### Permission decides autonomy

![Project permission: Ask for Approval / Workspace Access / Full Access](assets/readme/project-permission.png)

The first time you open a project you choose explicitly: **Workspace Access** (recommended; routine in-project actions run automatically and land in the audit log) or **Ask every time** (more careful; every write needs approval). **Full Access** removes the directory boundary and always requires an explicit first confirmation. Tool boundaries are enforced in the Tool Registry and the Rust layer — not by prompts.

## Bring your own model — with honesty about maturity

"Can chat ≠ can call tools ≠ can reliably finish a project-agent task." Providers carry a tier, shown in settings and here:

| Tier                  | Meaning                                                                  | Vendors                                                |
| --------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------ |
| **Agent Verified**    | Ran the Golden Agent Tasks against a real endpoint ([Agent Eval](eval/)) | GLM (Zhipu)                                            |
| **Protocol Verified** | Streaming + tool-call protocol covered by automated tests                | OpenAI, Anthropic, Google Gemini, Azure OpenAI, Ollama |
| **Preset**            | Configuration template, no agent-level evidence                          | the other 30 built-in presets                          |

Providers, protocols, and model capabilities are separate layers: 7 implemented protocol adapters (OpenAI Chat Completions / Responses, Anthropic Messages, Gemini, Azure OpenAI, native Ollama, OpenAI-compatible) and custom compatible endpoints. API keys live in a local encrypted vault (AES-256-GCM) and never enter logs.

![Provider settings: multiple vendors, models, capability badges and maturity tiers](assets/readme/provider-settings.png)

Capabilities (streaming, tool calling, vision, structured output) are shown before use; a model without tool calling can still chat but never receives project tools. See the [provider and protocol matrix](docs/13-provider-and-protocol-matrix.md).

## Product surfaces and maturity

**Evir Desktop is the primary product**; the other surfaces carry their real maturity, not parity marketing:

| Surface                                 | Maturity                | Notes                                                                             |
| --------------------------------------- | ----------------------- | --------------------------------------------------------------------------------- |
| **Desktop**                             | **Primary**             | All core product design lands here first; Agent Eval first; macOS / Windows first |
| Web                                     | Maintenance             | Clean multi-model chat; does not replicate Desktop agent capabilities             |
| VS Code                                 | Preview                 | In-editor agent (configure/Ask/Agent/approval/diff-rollback); blocking fixes only |
| CLI                                     | Preview                 | `evir` configure/doctor/ask/agent; core contract maintenance only                 |
| Plugin / Multi-user / Canvas / Ego Lite | **Experimental (Labs)** | Expansion frozen; not marketed as core capability                                 |

## Skills: quality over quantity

Built-in skills ship in two layers: **15 core coding skills** (systematic-debugging, test-driven-development, code-review, security-review, verification-before-completion, … — curated for the coding / project-agent path) plus an **optional general pack** (office, writing, analysis; enable per taste in settings). Skill count is not a KPI — core-skill value is checked against the [Agent Eval](eval/).

## Local-first and diagnosable

```text
API keys          → local encrypted vault (AES-256-GCM)
Provider config   → versioned non-sensitive local files
Chats/tasks/memory → embedded local storage (SQLite / IndexedDB)
Logs/diffs/snapshots → local directories
```

- No accounts, credits, ads, or required cloud backend; data stays on your device by default.
- Logs cover provider/agent/tools/approvals/performance — redacted by default, local, rotated; **there is no remote log-reading backdoor**; diagnostics bundles are exported manually by you.
- Context compaction, three-tier memory, checkpoints, and crash recovery are built in; one model handles all summarization — no second model required.

## Quality and verification

- **Deterministic tests**: `pnpm check` (format + lint + strict TS + full unit tests + Rust tests + release validation) plus E2E / UI / visual / accessibility matrices. Current baseline numbers live in [Release Readiness](docs/release-readiness.md) as the single source of truth — this README doesn't duplicate numbers that drift.
- **Agent Eval**: 20 Golden Agent Tasks on a frozen fixture repo (`pnpm test:agent-eval`), measuring success rate, unauthorized operations (must be 0), out-of-scope changes (must be 0), recovery, and completion evidence. The real-provider tier is honestly **NOT RUN** until real quota is spent.
- Performance budgets and measured numbers defer to the [latest benchmark](docs/benchmarks/latest.json) (web initial JS gzip ≤ 350 KiB, desktop frontend ≤ 15 MiB, cold-start P50 < 2s).

## Current status

Evir is under active development and **not released yet** (no LICENSE file — see below). The core path (chat, agent tools and approvals, Plan/Goal, permission profiles, snapshot rollback, MCP connections, logging and diagnostics export) is implemented. **Per-item verification status (including NOT RUN / BLOCKED lists) is owned by [Release Readiness](docs/release-readiness.md)**: Windows, 30–60 minute long tasks, and upgrade/downgrade are not yet verified. Installers are ad-hoc signed by default (they run); Developer ID signing/notarization is an optional enhancement.

## Local development

```bash
pnpm install
pnpm dev:web        # web dev server
pnpm dev:desktop    # Tauri desktop (needs Rust + Tauri 2 prerequisites)
pnpm check          # format + lint + strict TS + full unit tests + Rust tests + release validation
pnpm test:e2e       # Playwright E2E (web + desktop)
pnpm test:agent-eval # Agent Eval: 20 golden tasks (standalone §80 output)
pnpm benchmark      # bundle-size gates
```

Builds and releases (macOS arm64/x64 DMG, Windows x64 MSI, VSIX, CLI tarball) are in the [development guide](docs/03-development-guide.md). Requires Node.js 20+, pnpm 9+, Rust stable.

## Documentation

- Current status and fact index: [Release Readiness](docs/release-readiness.md) · [Project memory index](docs/agent/Evir-project-memory.md)
- Product and architecture: [Product Spec](docs/01-product-requirements.md) · [Technical Architecture](docs/02-technical-architecture.md)
- Specs: [Design](docs/04-design-specification.md) · [Engineering](docs/05-engineering-standards.md) · [Agent Security & Quality](docs/07-agent-security-and-quality.md)
- Topics: [Skills & MCP](docs/08-skill-and-mcp.md) · [Provider matrix](docs/13-provider-and-protocol-matrix.md) · [Agent Eval](eval/README.md)

## License

The license will be decided before the first public release. Third-party dependency licenses must be recorded and verified on introduction.
