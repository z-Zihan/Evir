# Evir MCP Runtime context

## Goal

Turn the existing Desktop-only MCP configuration surface into a truthful, local-first runtime that connects to stdio and Streamable HTTP servers, discovers tools, routes every call through Evir's Tool Registry and approval policy, and exposes enough state for users to test, recover, stop, and diagnose a server.

## Users and jobs

- A Desktop Agent user adds a trusted local or remote MCP server, reviews what it exposes, enables it, and uses an allowed tool without learning MCP internals.
- A power user can inspect schemas and errors, test a connection, restart it, and distinguish disabled, connecting, ready, reconnecting, and failed states.
- A security-conscious user can see whether a tool is local or remote, approve consequential actions, and disable or delete a server knowing its process and registrations are removed.

## Product boundaries

- MCP is optional, Desktop-only, default-disabled, and lazy. It is not part of first run and does not start at application boot.
- Web, VS Code, and CLI do not load configuration, connect to servers, or expose MCP tools.
- One tool-capable Provider remains sufficient for the core Desktop Agent.
- Evir owns authorization, approval, cancellation, audit, redaction, and completion verification. Server descriptions and results are untrusted data.
- This work adds tools first. Resources and prompts may be discovered for inspection but do not become model context until a separate consumer and security design exists.

## Success criteria

1. A real persistent stdio server completes initialize, notification, paginated discovery, and at least one tool call in the native app.
2. A real Streamable HTTP server completes the same supported lifecycle, including session handling and cancellation.
3. Discovered tools appear atomically in Tool Registry with `mcp-local` or `mcp-remote`, require `localMcp`, and disappear on disable, failure exhaustion, deletion, or shutdown.
4. The UI never says connected before initialization, discovery, and registration all succeed, and every failure state offers a concrete next action.
5. Secrets, full environment variables, file bodies, and full MCP results are absent from default logs.
6. Unit, Rust, integration, and native manual evidence are reported separately; mocks do not substitute for the native proof.

## Constraints

- Preserve `Types -> Config -> Repository -> Service -> Runtime -> UI` and use ports/adapters. React must not invoke Tauri, spawn processes, fetch MCP endpoints, or mutate Tool Registry directly.
- Keep heavy protocol/runtime code lazy and avoid idle polling.
- Use bounded timeouts, output limits, reconnect attempts, and cleanup waits. A new connection generation must not overlap an unclosed old stdio process.
- TypeScript remains strict and all wire/config input is runtime-validated.
