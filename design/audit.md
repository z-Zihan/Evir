target: Desktop Agent finished-run area shown in the 2026-08-27 screenshot  
goal: Let users understand the trustworthy task outcome first, then inspect evidence without duplicate status surfaces.

| #   | area       | issue                                                                                                  | sev  | fix                                                                                                                 | eff |
| --- | ---------- | ------------------------------------------------------------------------------------------------------ | ---- | ------------------------------------------------------------------------------------------------------------------- | --- |
| 1   | trust      | Model text says the tool is blocked while the product card says the task completed                     | HIGH | Reconcile the finished label with AgentRun evidence and prefer failed/partial over completed                        | M   |
| 2   | hierarchy  | Assistant output, orchestration status, and Agent run summary appear as three independent conclusions  | HIGH | Keep one collapsed task result card and nest plan/evidence details inside it                                        | M   |
| 3   | density    | File evidence tables and raw paths dominate the reading flow                                           | MED  | Keep generated detail in the message, but make product-owned evidence collapsed by default and use compact metadata | S   |
| 4   | clarity    | The evidence card communicates status mainly through icon/color                                        | MED  | Put the explicit reconciled status in the primary heading and retain text labels inside details                     | S   |
| 5   | flow       | Two adjacent expand affordances require users to guess which contains the authoritative result         | MED  | Use the task result chevron as the single disclosure control for structured run details                             | S   |
| 6   | continuity | Every persisted Agent-loop assistant record repeats the avatar, author, actions, and full turn spacing | HIGH | Group consecutive assistant records as one visual reply while preserving each stored execution record               | S   |
| 7   | responsive | Long conversation/provider labels can consume the header width and visually clip neighboring controls  | HIGH | Give the title a shrinkable flex track and ellipsize model metadata before controls leave the available width       | S   |
| 8   | alignment  | Task and evidence cards use different widths and do not share the assistant-content left edge          | HIGH | Put both structured surfaces on the assistant content rail with the same 820px cap and responsive inset             | S   |

notes: Screenshot inspection covered visual hierarchy and visible labels. Full VoiceOver behavior still requires manual assistive-technology verification.

verdict: The first two issues make the interface actively misleading, not merely visually busy. Fix them before cosmetic spacing changes.
