> **Status: Archived（历史执行产物）**
> 本文件是某一次工作轮的一次性执行/测试/审计记录，仅作历史证据，不代表当前产品状态，也不是规范来源。
> 当前事实来源：根目录 `AGENTS.md`、`docs/agent/Evir-project-memory.md` 与 `docs/` 正式文档。

# Evir Full Regression Report

## Final Gate

| Gate                                                       | Result | Detail                                                                             |
| ---------------------------------------------------------- | ------ | ---------------------------------------------------------------------------------- |
| `pnpm check`                                               | PASS   | format, lint, typecheck, 108 files / 675 tests, release workflow, VS Code 8, CLI 8 |
| comprehensive QA                                           | PASS   | 19 passed / 1 Web-not-applicable                                                   |
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
| `cargo test --all-targets --all-features`                  | PASS   | 37/37                                                                              |

## Code Review

变更意图：Bug 修复 + 指定 UX 调整；涉及 Composer 模式、模型能力降级、流状态、测试与文档。影响范围为核心聊天/Agent 链路，初始风险 Medium。

最终结论：可合入（审查置信度高）。审查额外发现并修复大输出管道提前关闭/中断、自动验证证据失真、L4 被权限档位自动放行、旧审批误命中新审批等问题。回归重点已覆盖 Project/Chat capability、Agent tool decision、Plan read-only、Goal 状态、Permission 三档、run ownership、Composer、Usage、验证状态、原生命令输出和四端构建。

## NOT RUN / BLOCKED

- Windows x64 与 macOS Intel 实机。
- 真实外部 Provider Agent 与外部 MCP 服务。
- VS Code Marketplace / npm 实际发布安装。
- Developer ID 正式签名、公证与 Gatekeeper 下载安装。
- VoiceOver 手工全流程。
