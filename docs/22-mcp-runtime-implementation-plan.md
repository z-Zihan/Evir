# Evir MCP Runtime implementation plan

> **状态**：§1-8 为实施前计划（Historical，2026-08-15 前的现状与选型记录）；§9 为实现状态与原生物证（Current）。Runtime 已实现并有测试与原生物证；剩余缺口见 §9 末尾。

## 1. Current-state finding

The current MCP page persists configurations and intentionally labels them unverified. `src/core/mcp/mcp-client.ts` is not wired into `createRuntime`; its stdio adapter starts a fresh `run_command` for every JSON-RPC request and passes the payload as a command-line argument. That is not MCP stdio, which requires one long-lived child with newline-delimited JSON-RPC over stdin/stdout. The HTTP draft also lacks protocol validation, notifications, pagination, request cancellation, bounded response handling, and generation-safe reconnect. No discovered MCP tool reaches Tool Registry.

DeepSeek Harness `47f943859b` demonstrates useful lifecycle patterns: one client/transport per connection generation, initialization before activation, full paginated discovery, notification-driven re-sync, fetch-then-swap tool generations, stable server-qualified names, abort-aware calls, bounded exponential reconnect, and disposal that waits for the previous generation to close. Its Cordis/plugin runtime and full package graph are not suitable dependencies for Evir.

## 2. Options considered

### Option A: import the DeepSeek Harness MCP plugin

This provides mature behavior quickly but also imports Cordis, Harness tool types, Node child-process assumptions, configuration composition, and a second lifecycle model. It conflicts with Tauri process ownership and Evir's Tool Registry/Permission Engine. Rejected.

### Option B: run the official TypeScript MCP SDK in the WebView

Streamable HTTP is feasible, but stdio would still require a bridge and the UI process would own protocol lifecycle and credentials. Browser fetch also creates CORS differences and weakens the required port/adapter direction. Rejected as the primary architecture.

### Option C: Evir-owned service with Rust stdio adapter and HTTP adapter

Use a small protocol service behind transport ports. Rust owns persistent child processes; a transport adapter owns Streamable HTTP. `McpRuntimeService` owns connection generations, initialization, discovery, reconnect, and status. `McpToolAdapter` registers tools through ComponentRuntime effects and existing Tool Registry. This preserves Evir architecture and is the selected option.

## 3. Target architecture

```text
McpServer config + secret references
  -> McpServerRepository
  -> McpRuntimeService (lazy, Desktop only)
       -> StdioMcpTransportPort -> Tauri/Rust persistent process manager
       -> HttpMcpTransportPort  -> Streamable HTTP adapter
       -> initialize + notifications + paginated discovery
       -> connection generation + bounded reconnect
  -> McpToolAdapter
  -> ComponentRuntime effect scope
  -> Tool Registry
  -> ToolExecutor -> mode/capability/approval/cancel/audit
  -> UI view model/store
```

There is one runtime instance per enabled server. A connection is `ready` only after `initialize`, `notifications/initialized`, complete discovery, schema validation, and atomic tool registration. A reconnect creates a fresh generation; callbacks from stale generations are ignored.

## 4. State and UI model

| State          | Meaning                                                 | User action                               |
| -------------- | ------------------------------------------------------- | ----------------------------------------- |
| `disabled`     | persisted but cannot connect or expose tools            | Enable or test                            |
| `starting`     | process/request transport is being created              | Cancel                                    |
| `initializing` | protocol negotiation is in progress                     | Cancel                                    |
| `discovering`  | capabilities/tools are being fetched and validated      | Cancel                                    |
| `ready`        | discovery and Tool Registry publication succeeded       | Inspect, test tool, restart, disable      |
| `reconnecting` | live generation failed; previous tools are unavailable  | Retry now, disable                        |
| `stopping`     | calls are cancelled and process/session is closing      | Wait                                      |
| `error`        | retry budget exhausted or configuration/protocol failed | View redacted error, retry, edit, disable |

The list shows transport, state, tool count, last successful connection, and a short redacted error. Details show server metadata, capabilities, schemas, PID for stdio, test call, reconnect/restart controls, and bounded recent logs. Enabling is not synonymous with ready.

## 5. Security and trust decisions

- New servers remain disabled. Starting a local executable or contacting a new remote destination requires explicit user intent.
- Rust clears the inherited environment and restores only an allowlisted operational baseline plus values resolved from secure-store references (local encrypted vault). Secrets never cross persistence or logs as plain configuration.
- Each discovered tool uses source `mcp-local` or `mcp-remote`, required capability `localMcp`, and a conservative risk level. Later per-tool policy can narrow risk; server claims cannot lower it.
- Remote calls are subject to network destination and local-data-upload policy. Tool Registry and ToolExecutor remain authoritative; prompts cannot bypass them.
- Wire messages, schemas, descriptions, cursors, content blocks, headers, and errors are untrusted. Validate types, cap sizes/counts, and redact before logging.
- Disabling/deleting a server cancels calls, removes the full tool generation, closes the HTTP session, terminates the process tree, and clears non-sensitive runtime cache.

## 6. Lifecycle contracts

1. `connect` is idempotent per desired configuration fingerprint.
2. Only one live generation may own a server id.
3. Discovery fetches every `tools/list` page before changing Tool Registry. A fetch failure keeps no partially published next generation.
4. Tool names are deterministic functions of `(server id, raw tool name)` and are never parsed to recover the raw name.
5. Every request has a timeout and AbortSignal. Cancellation rejects the caller and cannot later publish stale results.
6. Reconnect uses bounded exponential backoff and stops after a configurable cap. Timers do not poll while healthy.
7. `dispose` cancels timers and calls, unregisters tools, closes transport, and waits for bounded process shutdown.

## 7. Incremental delivery

### Phase 1: protocol and persistent stdio foundation

- Add a Rust process manager with start, request, status, and stop commands; newline-delimited JSON-RPC uses a persistent stdin/stdout pair.
- Clear/allowlist environment, drain bounded stderr, expose PID, kill the process tree, and reject duplicate/stale ids.
- Add strict TypeScript wire schemas, request timeout/cancellation, initialize and `notifications/initialized`, paginated tool discovery.
- Verify with a real fixture MCP server that requires persistence across initialize/list/call.

### Phase 2: Streamable HTTP and connection generations

- Implement session id handling, JSON/SSE response parsing, DELETE close when supported, AbortSignal, response caps, and protocol errors.
- Add bounded exponential reconnect, stale-generation guards, tool-list-change re-sync, and no-overlap teardown.

### Phase 3: Tool Registry and policy integration

- Build deterministic public names and MCP result projection.
- Atomically register/unregister a generation through ComponentRuntime-owned effects.
- Route calls through ToolExecutor with source, capability, conservative risk, approval, cancellation, and audit metadata.

### Phase 4: persistence and product states

- Replace direct UI storage access with repository/service/view-model ports.
- Add test connection, status, tool inspection/test, enable/disable/restart/delete cleanup, errors and recovery copy in Chinese and English.
- Keep all MCP chunks and runtime imports Desktop-only and lazy.

### Phase 5: verification and closure

- Unit: validators, naming, pagination, atomic generation swap, stale callbacks, reconnect budget, cancellation, redaction.
- Rust: persistent process lifecycle, malformed output, timeout, exit, bounded stderr, environment allowlist, process-tree stop.
- Integration: real stdio fixture and real Streamable HTTP fixture through initialize/list/call/reconnect.
- Product: rendered Desktop states, keyboard/a11y checks, deletion confirmation, no MCP in Web/VS Code/CLI.
- Native: connect and invoke at least one real external MCP server in a Tauri build; record PID, discovered tool, approval, result, stop, restart, and cleanup evidence.

## 8. Acceptance gates

- `pnpm exec vitest run src` passes; Playwright suites run separately.
- `cargo test --manifest-path src-tauri/Cargo.toml` passes.
- `pnpm lint`, `pnpm typecheck`, Desktop frontend build, and relevant E2E/a11y tests pass.
- No secret or full environment appears in logs, snapshots, diagnostics, or persisted MCP rows.
- Startup measurements show disabled MCP causes no process, request, schema load, idle timer, or material bundle regression.
- Completion is not claimed until native stdio and Streamable HTTP evidence exists. Any unverified transport or UI branch is reported explicitly.

## 9. Implementation status — 2026-08-15

Implemented:

- Persistent Rust stdio process ownership, bounded stdout/stderr draining, strict JSON-RPC request ownership, environment allowlisting, Unix process groups, and Windows process-tree termination.
- Streamable HTTP sessions with JSON/SSE responses, GET notification streams, hard response bounds, cancellation/timeouts through body consumption, protocol headers, and bounded best-effort DELETE close.
- Initialization, negotiated protocol validation, initialized notification, fully bounded paginated discovery, repeated-cursor rejection, and notification-driven tool refresh.
- Generation-safe runtime lifecycle, bounded reconnect, no-overlap restart/disable barriers, atomic Tool Registry publication, and preservation of the previous good generation on registration conflict.
- ToolExecutor routing with Desktop capability gates, conservative MCP risk/source metadata, explicit approval facts, remote destination disclosure, and invalid persisted approval-metadata rejection.
- Repository-backed configuration, disabled-server connection testing without publication, enable/disable/restart/delete cleanup, tool inspection/test, PID/protocol/server/last-ready state, and truthful Chinese/English copy.
- Desktop-only lazy runtime chunks. The 2026-08-15 benchmark reports a 313.56 KiB desktop initial-JS gzip size and separate `mcp-repository`/`runtime-service` chunks; the configured frontend budget passes.
- Raw MCP stderr remains internally bounded only to drain the process safely and is not exposed through the Tauri status boundary.
- The current arm64 release app and DMG build with an explicit local ad-hoc identity. The DMG is 5,513,532 bytes (5.26 MiB) with SHA-256 `f71834d5db4f19931f083543cd001d6205106a67954ffc318751fb05040d4335`; this proves local package structure only, not Developer ID signing or notarization.
- Remote L4 tool-test confirmation now exposes the exact configured destination before execution. Tool-test inputs disable autocorrect, autocapitalization, and spellcheck so macOS does not silently replace JSON quotes, and restart/disable clears stale result output.

Current automated evidence:

- `pnpm exec vitest run src`: 80 files, 479 tests passed.
- `cargo test --manifest-path src-tauri/Cargo.toml`: 17 tests passed, including persistent multi-request ownership and Unix process-group cleanup.
- `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, Desktop frontend build, and Rust clippy passed.
- `pnpm test:e2e`: 30 passed, 8 platform-inapplicable Web cases skipped.
- `pnpm test:a11y`: 18 passed.
- `pnpm test:ui`: Web and Desktop matrices passed across English/Chinese, light/dark, and responsive widths. The Desktop matrix now exercises a configured disabled MCP server and a bounded connection-error state at 390 px; reviewed screenshots show readable wrapping without horizontal clipping.
- Native arm64 Tauri stdio fixture evidence completed the full product path: disabled connection test discovered one tool without leaving a process; enable reached protocol `2025-06-18` and server `evir-native-fixture 1.0.0`; the L3 confirmation guarded `fixture_echo`; the call result reported PID `33623`; restart changed it to `33776` and the old PID exited; disable terminated the replacement process.
- Native arm64 Tauri Streamable HTTP fixture evidence completed disabled connection test, discovery, L4 approval, call, restart, reconnect, recovery, and close. A restart kept fixture PID `34668` while changing the MCP session from `cc2b3713-cfd2-491a-9bea-9b621d677b19` to `6e28cc5b-4ac6-4cab-843d-9587bfb9d2b3`. Terminating the server moved the product to `reconnecting` and removed its tools; restarting on the same port restored `ready`. The recovered call used PID `34866` and session `dfee1a05-118d-4433-b821-f243c06fb56e`; after disable, a GET with that old session returned HTTP 404, proving session deletion.
- The deterministic HTTP fixture now implements CORS preflight/response headers because the current HTTP adapter runs through WebView `fetch`. This native evidence therefore proves the product path for a browser-compatible MCP endpoint; arbitrary external servers that do not permit the Tauri origin remain unverified.
- A disabled-MCP arm64 release sample showed 0.0% main-process CPU, 103,008-103,088 KiB RSS, no MCP child, and no TCP socket at 8-24 seconds after launch. With the HTTP MCP enabled, the main process sampled at 105,424 KiB RSS and 0.0% CPU, while the matching WebKit networking process owned the expected loopback event-stream socket. These are point samples, not a statistically rigorous startup, latency, or log-overhead benchmark.

Still required before completion:

- Capture the MCP-specific approval facts in the native Agent conversation surface; the native Settings tool-test surface now proves L3/L4 confirmation, the remote destination, and a protected result, but it is not a model-originated Agent run.
- Replace or harden WebView HTTP transport so remote MCP compatibility does not depend on endpoint CORS policy, or explicitly make browser-compatible CORS a documented server requirement.
- Run repeatable native startup, idle CPU/memory, stream-latency, and log-overhead measurements with MCP disabled and enabled. The current point samples and bundle splitting do not prove those budgets.
- Run at least one compatible external MCP server, not only the deterministic local fixtures.
- Verify Windows process-tree termination and packaging on a Windows host.
