# Evir Functional Test Report

## 结论

本轮可自动化与本机可执行的核心功能全部通过，最终无 P0/P1 未修复缺陷。Web、Desktop frontend、VS Code、CLI、Rust/Tauri 均有独立证据；浏览器 Desktop fixture 不计作原生宿主证据。

## 覆盖结果

| 领域                                        | 结果 | 证据                     |
| ------------------------------------------- | ---- | ------------------------ |
| 首次启动、能力边界、Provider 设置           | PASS | `pnpm test:e2e`          |
| Chat 流式、Stop、错误恢复、跨会话归属       | PASS | `pnpm test:e2e` + stress |
| Project/Chat 导航与持久化                   | PASS | Desktop E2E              |
| 默认 Project Task、Plan、Goal、文本模型降级 | PASS | Unit + Desktop E2E       |
| Agent 活动、审批、取消、恢复证据            | PASS | Desktop E2E + unit       |
| Usage 与 Composer Token 移除                | PASS | E2E                      |
| Diagnostics 脱敏导出                        | PASS | E2E                      |
| Web/VS Code/CLI 构建                        | PASS | production builds        |
| Desktop arm64 构建与打包                    | PASS | `.app` + 6.34 MB DMG     |

## 限制

当前运行未覆盖真实外部 Provider、外部 MCP、Windows、Intel 实机、商店发布、Developer ID 签名/公证和 VoiceOver。原生 `.app` 已构建并被系统识别为运行中，但 AX 返回 `AXError.cannotComplete`，故原生点击链路记为 NOT RUN，而不是 PASS。
