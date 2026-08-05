# Evir Agent Instructions

## Product

Evir is a clean, local-first, BYOM AI client and desktop agent. One tool-capable model must be sufficient for the core Desktop Agent. Do not add mandatory accounts, credits, ads, cloud backend, secondary models, embedding services, Skills, or MCP configuration to the first-run path.

## Required reading

Before modifying code, read:

1. `docs/18-final-product-review-v6.md`
2. `docs/01-product-requirements.md`
3. `docs/02-technical-architecture.md`
4. `docs/04-design-specification.md`
5. `docs/05-engineering-standards.md`
6. `docs/15-final-experience-model-switching-and-context.md`
7. `docs/16-harness-engineering-for-evir.md`
8. `docs/17-local-logging-and-diagnostics.md`
9. The task-relevant documents under `docs/`

## Architecture dependency direction

```text
Types → Config → Repository → Service → Runtime → UI
```

UI must not directly call Provider SDKs, Tauri commands, SQLite, Shell, Keychain, MCP processes, or log files. Use ports/adapters.

## Core product rules

- Main UI stays simple: model, Ask/Plan/Agent, input, send/stop, essential task state.
- Ask has no autonomous local access.
- Plan has authorized read-only tools.
- Agent has permission-controlled write/execute tools.
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
