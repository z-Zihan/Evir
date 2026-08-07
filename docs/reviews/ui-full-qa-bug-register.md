# Evir Full UI QA Bug Register

> Final status, 2026-08-07. No confirmed P0/P1 implementation defects remain open in the audited reachable scope.

| ID       | Priority | Finding                                                                      | Resolution / evidence                                               | Status                     |
| -------- | -------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------- | -------------------------- |
| UIQA-001 | P1       | Documentation claimed absent surfaces                                        | User/product docs now distinguish current UI from future scope      | Verified                   |
| UIQA-002 | P1       | MCP configuration could imply a live connection                              | Page and copy explicitly say configuration only                     | Verified / Partial product |
| UIQA-003 | P2       | Visual evidence was too narrow                                               | 258 Web/Desktop/theme/locale/viewport screenshots plus 6 baselines  | Verified                   |
| UIQA-004 | P2       | README described Web Plan                                                    | README now states Ask-only Web boundary                             | Verified                   |
| UIQA-005 | P1       | Hidden Web Agent mode could dead-end sending                                 | Web execution is forced to Ask; browser flow passes                 | Verified                   |
| UIQA-006 | P1       | Diagnostics used idle polling                                                | Logger subscription replaces polling                                | Verified                   |
| UIQA-007 | P1       | Nested settings/crop/shortcut dialogs had incomplete focus behavior          | Focus trap, Escape precedence and focus return covered              | Verified                   |
| UIQA-008 | P1       | Model switcher lacked complete keyboard listbox navigation                   | Arrow/Home/End/Enter/Escape and return covered                      | Verified                   |
| UIQA-009 | P2       | Missing `common.loading` exposed a raw key                                   | Locale key added and tested                                         | Verified                   |
| UIQA-010 | P1       | Settings scroll area was not keyboard focusable in Safari                    | Labelled focusable scroll region; all-page axe pass                 | Verified                   |
| UIQA-011 | P1       | Cancelled Agent activity could appear completed                              | Explicit cancelled terminal state and regression tests              | Verified                   |
| UIQA-012 | P1       | Agent evidence disappeared after reload and orphan records survived deletion | Latest run reloads; conversation deletion cascades run/tool records | Verified                   |
| UIQA-013 | P1       | Workspace UI called a Tauri plugin directly                                  | Directory selection moved behind `EvirRuntime`                      | Verified                   |

## External validation register

| Area                 | Why it remains external                                                                       |
| -------------------- | --------------------------------------------------------------------------------------------- |
| Real providers       | Requires user-owned paid credentials and real CORS/network/timeout conditions                 |
| MCP runtime          | Connection/discovery/call lifecycle is not implemented; current UI is intentionally Partial   |
| Native Agent task    | Requires unlocked native UI, real workspace writes, approval, verification, diff and rollback |
| Native macOS UI      | Release and debug binaries start, but this run’s Mac was locked for interaction QA            |
| Distribution         | macOS bundle reached codesign and failed with `no identity found`; Windows runner unavailable |
| Assistive technology | Automated axe passes; manual VoiceOver/screen-reader pass still required                      |
| Runtime performance  | Bundle/test benchmark passes; formal cold-start, idle CPU and memory measurements remain      |
