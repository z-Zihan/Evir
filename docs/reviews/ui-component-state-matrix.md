# Evir UI Component State Matrix

> Final evidence summary for the 2026-08-07 remediation pass. Source-only checks are not treated as rendered proof.

| Component                  | States covered                                              | Keyboard / semantics                                    | Evidence                        |
| -------------------------- | ----------------------------------------------------------- | ------------------------------------------------------- | ------------------------------- |
| Buttons and icon buttons   | default, disabled, pending, selected, danger                | names, tooltips, focus-visible, Enter/Space             | Unit, axe and screenshot matrix |
| Inputs / composer          | empty, multiline, attachment, sending, stopped, error       | labels, shortcuts, stable focus                         | E2E and visual matrix           |
| Model switcher             | open, selected, disabled, long labels                       | Arrow keys, Home/End, Enter, Escape, focus return       | Unit + browser E2E              |
| Settings / nested dialogs  | open, save, cancel, Escape, nested crop                     | initial focus, Tab loop, top-layer Escape, focus return | Unit + browser a11y             |
| Confirmation dialog        | normal and destructive                                      | cancel-first focus, trap, Escape, focus return          | Unit + E2E                      |
| Settings scroll region     | long page at 800x600                                        | labelled, keyboard focusable                            | axe + screenshot matrix         |
| Sidebar / conversation row | search, selected, rename, pin, reload, delete               | labelled actions and keyboard reachability              | E2E                             |
| Chat message               | markdown, 5000 chars, long URL, table, 100-line code        | actions reachable; overflow contained                   | E2E + screenshots               |
| Streaming / recovery       | stream, stop, provider failure, startup failure, retry      | status/alert semantics and actionable recovery          | E2E                             |
| Agent Activity             | approval, 12 steps, collapsed/expanded, complete, cancelled | expandable controls; cancelled never says completed     | Unit + Desktop E2E              |
| Workspace                  | select state, clear cancel/confirm, reload                  | confirmation semantics                                  | Desktop E2E                     |
| Preferences                | theme, language, personalization selection                  | semantic selected state (`aria-pressed`)                | E2E + axe                       |

## Durable interaction rules

- Icon-only actions require an accessible name and tooltip.
- Every modal requires initial focus, containment, Escape handling and opener focus restoration.
- A nested overlay owns Escape before its parent.
- Scrollable regions that can hide content must be keyboard-focusable and labelled.
- Visual selection requires semantic selected state, not color alone.
- Disabled controls need an adjacent or programmatically associated reason.
- A cancelled or interrupted Agent run must never be presented as completed.
- Provider and MCP copy may say “connected” only after a verified live connection.
