# Evir Full UI / UX / Product-Logic QA Report

> **历史快照（2026-08-07 整改验收）**。其中“Desktop defaults to Agent / Plan is internal”与 MCP 状态为旧信息架构；当前模型见 `docs/01-product-requirements.md`。
> Date: 2026-08-07
> Scope: all currently reachable Web and Desktop-simulated UI, critical states, persistence, product truthfulness and available native build/start evidence.

## A. Outcome

- Deterministic reachable UI: **Passed**.
- Confirmed P0/P1 defects left open: **0**.
- Current partial product surfaces: **MCP configuration only**, explicitly labelled.
- Release readiness: **Not yet**; only external/native/cross-platform validation remains.

## B. Product boundaries verified

- Web exposes Ask chat and attachments only; it does not expose Agent, Plan, workspace or MCP.
- Desktop defaults to Agent and can switch to Ask; Plan is an internal read-only Agent phase.
- The main UI remains model, mode, conversation, composer, send/stop and essential task state.
- Provider and MCP wording describes configuration, not an unverified connection.

## C. Critical flow evidence

- First run, deterministic stream/stop/error/retry.
- Conversation rename, pin, reload and delete.
- Provider edit and theme persistence.
- Dense and cancelled Agent activity, approval grouping and completion evidence after reload.
- Startup storage failure/retry and interrupted-run recovery without replay.
- Workspace clear cancel/confirm/persistence.
- Extreme long text, URL, table and code overflow.
- Settings, nested forms, avatar crop, shortcut help and model listbox keyboard behavior.

## D. Visual and responsive evidence

- 358 generated screenshots: Web 173, Desktop 185.
- Conversation viewports: 1600×1000, 1440×900, 1280×800, 1024×768, 900×700, 800×600 and 720×800.
- Settings: Light/Dark × zh-CN/en × 1280×800/800×600/390×844.
- Representative settings and conversation screenshots were manually inspected. At 800×600, long settings pages scroll within the labelled settings region; no horizontal layout break was observed.
- Six checked-in visual baselines pass.

## E. Accessibility evidence

- All reachable settings pages were traversed in Web and Desktop projects.
- Dialog initial focus, Tab containment, Escape precedence and focus return are browser-tested.
- Model listbox keyboard navigation and scroll-region accessibility are covered.
- axe: 16/16 passed with no serious violations in the tested states, including compact sidebar/settings layout and focus order.

## F. Automated quality gates

- `pnpm check`: 54 files / 338 tests passed; formatting, lint and strict typecheck passed.
- `pnpm test:e2e`: 24 passed; 6 expected Web capability skips.
- `pnpm test:ui`: 2 passed and generated 358 screenshots.
- `pnpm test:visual`: 6 passed.
- `pnpm test:a11y`: 16 passed.
- Rust: fmt, Clippy with warnings denied, 7 tests and debug build passed.
- Web/Desktop frontend builds passed; Web JS gzip 280.06 KB and CSS gzip 21.56 KB, within the 350 KB JS budget. The main minified chunk still exceeds the 500 KB warning threshold and remains code-splitting debt.

## G. Native evidence

- A real Tauri debug application and `target/debug/evir` started without startup errors.
- Release binary generation succeeded. macOS `.app` bundling reached signing and failed because no signing identity exists (`no identity found`).
- The Mac was locked during this pass, so native window interaction was not claimed as verified.

## H. Remaining external/manual work

1. Real paid-provider credentials and actual CORS/network/timeout behavior.
2. Native Agent write/approval/verification/diff/rollback task and native workspace permission flow.
3. MCP connection, discovery, authorization and runtime invocation implementation and validation.
4. Signed/notarized macOS package and Windows build/install/native UI.
5. Manual screen-reader pass and formal cold-start, idle CPU/memory measurements.

## I. Release judgment

The in-repository, deterministic UI remediation is complete and its P0/P1 register is closed. The product must not be called release-ready until the external/native items in section H pass. No absent feature is counted as completed.

## J. Evidence map

- Page inventory: `docs/reviews/ui-page-inventory.md`
- Component states: `docs/reviews/ui-component-state-matrix.md`
- Bug register: `docs/reviews/ui-full-qa-bug-register.md`
- Browser suites: `e2e/core.spec.ts`, `e2e/accessibility.spec.ts`, `e2e/ui-matrix.spec.ts`, `e2e/visual.spec.ts`
- Screenshot artifacts: `artifacts/playwright/screenshots/`
