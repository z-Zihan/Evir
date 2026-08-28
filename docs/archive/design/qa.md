# Memory experience design QA

Date: 2026-08-12

## Verdict

Pass for the web-rendered Desktop UI. Native Tauri rendering remains a separate acceptance surface and is not claimed by this check.

## Evidence

- Desktop viewport (1280 x 720): opened Settings > Memory, verified the empty state, created a 30-day global memory, and verified source, scope, expiry, enable, pin, edit, delete, and clear controls.
- Conversation surface (1280 x 720): saved a user message through Remember and verified the action changed to a disabled Remembered state, preventing an accidental duplicate save.
- Narrow viewport (600 x 820): opened Memory through the responsive settings selector. The dialog stayed within the viewport (`scrollWidth = innerWidth = 600`), the create form collapsed to one column, and all fields and the primary action remained visible.
- Accessibility tree: the Memory heading, global recall checkbox, scope and expiry comboboxes, form fields, empty state, and per-memory actions exposed usable roles and names. Icon-only controls exposed localized accessible names.
- Private-session behavior is covered by component and runtime tests: Remember is omitted and memory retrieval is bypassed. Private model switching does not create a durable checkpoint or handoff.

## Requirement comparison

| Requirement              | Result | Notes                                                                                                |
| ------------------------ | ------ | ---------------------------------------------------------------------------------------------------- |
| Local and optional       | Pass   | Memory is managed in Settings and is not part of first-run setup.                                    |
| Understandable hierarchy | Pass   | Recall control, create form, saved items, and destructive action are visually separated.             |
| User control             | Pass   | Global recall plus per-item enable, pin, edit, delete, expiry, and clear-all controls are available. |
| Responsive layout        | Pass   | One-column narrow layout has no horizontal overflow at 600 px.                                       |
| Safe destructive actions | Pass   | Delete and clear-all require confirmation.                                                           |
| Honest status            | Pass   | Empty, loading, error, enabled, disabled, saving, saved, and failed states are represented.          |

## Residual notes

- The local preview provider displayed an unrelated Tool Calling capability warning after sending a message. This does not affect the Memory interaction and was not treated as native-provider evidence.
- Native Tauri visual acceptance should still be performed during release validation.
