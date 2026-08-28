# Evir Agent Instructions

## Product

Evir is a clean, local-first, BYOM AI client and desktop agent. One tool-capable model must be sufficient for the core Desktop Agent. Do not add mandatory accounts, credits, ads, cloud backend, secondary models, embedding services, Skills, or MCP configuration to the first-run path.

## Required reading

Before modifying code, read:

1. `docs/agent/Evir-project-memory.md` — current implementation status, gate baseline, and known gaps (high-density index).
2. `docs/README.md` — topic → authoritative-doc map. From it, pick only the document(s) directly relevant to your task.

Do not load the full doc set for a small change; one task-relevant architecture/spec document plus the memory index is enough. Historical material lives in `docs/archive/`, `docs/reviews/`, and `docs/references/` and is not a source of truth. The current information architecture (Sidebar Projects/Chats, Project Task default with Plan/Goal as explicit modes, Permission Profiles) is specified in `docs/01-product-requirements.md`.

## Architecture dependency direction

```text
Types → Config → Repository → Service → Runtime → UI
```

UI must not directly call Provider SDKs, Tauri commands, SQLite, Shell, Keychain, MCP processes, or log files. Use ports/adapters.

## Core product rules

- Main UI stays simple: model, mode, input, send/stop, essential task state.
- Sidebar is organized as Projects and Chats; project directories come from Projects, not a workspace selector.
- Ask has no autonomous local access (standalone chats are always Ask).
- Plan is a first-class mode in project threads with read-only tools (L1) followed by Execute Plan.
- Goal is a first-class mode for long-running objectives with explicit doneWhen conditions.
- Agent has permission-controlled write/execute tools under per-project permission profiles (ask/workspace/full).
- Tool boundaries are enforced in Tool Registry, not only prompts.
- A model without tool calling cannot run Agent mode.
- Model switching uses ModelSwitchCoordinator and safe checkpoints.
- Cross-provider switching requires data-destination awareness.
- Context compaction preserves user constraints, approvals, run state, changes, errors, and verification.
- No remote logging backdoor. Logs are local, redacted, bounded, and user-exported.

## Harness

Use composable middleware for normalization, mode policy, capability gates, context budget, skill routing, tool policy, loop detection, checkpoints, verification, and observability. Each layer must be independently testable and removable.

## Performance

- No full Chromium.
- No idle polling.
- Lazy-load heavy modules and sidecars.
- Do not load all Skills or start MCP servers at startup.
- Batch stream rendering and storage writes.
- Keep full logs/tool output out of React state.
- Measure startup, memory, CPU, bundle/package size, stream latency, long lists, context compaction, model switching, and log overhead.

## Safety and diagnostics

- Validate all external and model-generated input.
- Redact secrets before logging.
- Never log API keys, Authorization, cookies, environment variables, full conversations, or file bodies by default.
- High-risk actions require explicit approval.
- Model text alone cannot mark a task complete; use verification evidence.

## Code quality

- TypeScript strict; no `any` or hidden ignores.
- Keep components/modules within documented size budgets.
- Add tests before claiming completion.
- Do not disable checks or delete tests to pass CI.
- Do not use placeholders or TODOs to claim a feature works.
- After each phase, run the full available quality gate and report actual results.

## Project Memory

开发 Evir 前，必须读取：

- `docs/agent/Evir-project-memory.md`

该文件仅适用于 Evir 仓库，不得作为全局或跨项目记忆使用。

项目记忆只是高密度索引。出现疑问、冲突或需要具体细节时，必须继续读取对应的原始文档，不得只依赖记忆摘要。
