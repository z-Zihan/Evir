# Evir UI Page Inventory

> **历史快照（2026-08-07）**。UI-009（Workspace selector）已移除；UI-018 MCP 状态已更新为已实现（2026-08-15）。
> Final deterministic QA inventory, 2026-08-07. `Verified` means source plus automated browser/rendered evidence in this pass. `Partial` means the reachable UI is truthful and usable, but the underlying product loop is intentionally incomplete.

| ID     |                                    Page / region | Web | Desktop | Current result                                                  |
| ------ | -----------------------------------------------: | --: | ------: | --------------------------------------------------------------- |
| UI-001 |                       First launch / no provider | Yes |     Yes | Verified                                                        |
| UI-002 |                               Empty conversation | Yes |     Yes | Verified                                                        |
| UI-003 |                 Conversation / history / actions | Yes |     Yes | Verified                                                        |
| UI-004 |                   Long text, URL, table and code | Yes |     Yes | Verified                                                        |
| UI-005 |                Streaming / stop / provider error | Yes |     Yes | Verified                                                        |
| UI-006 |     Agent Activity: dense / complete / cancelled |  No |     Yes | Verified                                                        |
| UI-007 |                                   Agent approval |  No |     Yes | Verified with deterministic fixture                             |
| UI-008 | Agent summary / persisted evidence / rollback UI |  No |     Yes | Verified in browser; native real-task loop remains external     |
| UI-009 |         Workspace selector / clear / persistence |  No |     Yes | Verified in browser; native picker interaction remains external |
| UI-010 |         Sidebar / search / rename / pin / delete | Yes |     Yes | Verified                                                        |
| UI-011 |                Model selector / keyboard listbox | Yes |     Yes | Verified                                                        |
| UI-012 |                               Ask / Agent switch |  No |     Yes | Verified                                                        |
| UI-013 |           Settings shell and all reachable pages | Yes |     Yes | Verified                                                        |
| UI-014 |         Provider list / add / edit / persistence | Yes |     Yes | Verified with fixture; real credentials external                |
| UI-015 |                     Local identity / avatar crop | Yes |     Yes | Verified                                                        |
| UI-016 |               Personalization / theme / language | Yes |     Yes | Verified                                                        |
| UI-017 |                                           Skills | Yes |     Yes | Verified for current management UI                              |
| UI-018 |                                MCP configuration |  No |     Yes | Partial: configuration only; no connection claim                |
| UI-019 |                       Memory / shortcuts / usage | Yes |     Yes | Verified                                                        |
| UI-020 |                            Shortcut help overlay | Yes |     Yes | Verified                                                        |
| UI-021 |                 Data and privacy / confirmations | Yes |     Yes | Verified                                                        |
| UI-022 |                              Diagnostics / About | Yes |     Yes | Verified for current in-memory JSON scope                       |
| UI-023 |             Startup initialization error / retry | Yes |     Yes | Verified                                                        |
| UI-024 |                  Interrupted-run recovery notice |  No |     Yes | Verified in browser; no tool replay                             |
| UI-025 |                                   Error boundary | Yes |     Yes | Source/unit verified                                            |

## Explicitly absent or external

- No notification settings, command palette, in-app help center, feedback form, advanced Markdown persona editor, or full diagnostic ZIP.
- No MCP connection, discovery, runtime-call, restart or debugger surface; the current Desktop page only manages configuration.
- Real paid-provider/CORS/timeout behavior, a native Agent task that writes and rolls back a real workspace, native picker/system-permission interaction, signed macOS packaging and Windows remain external validation.
- These items are not counted as completed functionality.
