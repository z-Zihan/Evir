# Evir Full Regression Report

## Final Gate

| Gate                                                       | Result | Detail                                                                             |
| ---------------------------------------------------------- | ------ | ---------------------------------------------------------------------------------- |
| `pnpm check`                                               | PASS   | format, lint, typecheck, 105 files / 647 tests, release workflow, VS Code 8, CLI 8 |
| `pnpm test:e2e`                                            | PASS   | 38 passed / 10 platform-skipped                                                    |
| `pnpm test:stress`                                         | PASS   | 7 passed / 1 Web-not-applicable                                                    |
| `pnpm test:ui`                                             | PASS   | 2/2; 366 screenshots                                                               |
| `pnpm test:visual`                                         | PASS   | 6/6                                                                                |
| `pnpm test:a11y`                                           | PASS   | 18/18                                                                              |
| `pnpm benchmark`                                           | PASS   | budgets pass; `docs/benchmarks/latest.json`                                        |
| `pnpm build:web`                                           | PASS   | Vite production build                                                              |
| `pnpm build:desktop`                                       | PASS   | arm64 `.app` + DMG, ad-hoc signed                                                  |
| `pnpm build:vscode`                                        | PASS   | 381.9 KB bundle                                                                    |
| VS Code Extension Host                                     | PASS   | host started and exited 0; environment watcher warnings recorded                   |
| `pnpm build:cli`                                           | PASS   | 357.0 KB bundle                                                                    |
| VSIX/package/CLI smoke                                     | PASS   | package artifacts and CLI smoke completed in this QA run                           |
| `cargo fmt --check`                                        | PASS   | no diff                                                                            |
| `cargo clippy --all-targets --all-features -- -D warnings` | PASS   | no warnings                                                                        |
| `cargo test --all-targets --all-features`                  | PASS   | 31/31                                                                              |

## Code Review

变更意图：Bug 修复 + 指定 UX 调整；涉及 Composer 模式、模型能力降级、流状态、测试与文档。影响范围为核心聊天/Agent 链路，初始风险 Medium。

最终结论：可合入（审查置信度高）。未发现未修复的阻塞性逻辑问题；发现的格式门禁问题已修复。回归重点已覆盖 Project/Chat capability、Agent tool decision、Plan read-only 边界、Goal、Permission、run ownership、Composer、Usage、UI 状态和四端构建。

## NOT RUN / BLOCKED

- 原生 macOS 关键点击：`AXError.cannotComplete`，只能证明 release app 启动，不能证明交互。
- Windows x64 与 macOS Intel 实机。
- 真实外部 Provider Agent 与外部 MCP 服务。
- VS Code Marketplace / npm 实际发布安装。
- Developer ID 正式签名、公证与 Gatekeeper 下载安装。
- VoiceOver 手工全流程。
