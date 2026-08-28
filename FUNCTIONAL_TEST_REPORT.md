# Evir Functional Test Report

## 结论

本轮可自动化与本机可执行的核心功能全部通过，最终无 P0/P1 未修复缺陷。Web、Desktop frontend、VS Code、CLI、Rust/Tauri 均有独立证据；浏览器 Desktop fixture 不计作原生宿主证据。

## 覆盖结果

| 领域                                        | 结果 | 证据                       |
| ------------------------------------------- | ---- | -------------------------- |
| 首次启动、能力边界、Provider 设置           | PASS | `pnpm test:e2e`            |
| Chat 流式、Stop、错误恢复、跨会话归属       | PASS | `pnpm test:e2e` + stress   |
| Project/Chat 导航与持久化                   | PASS | Desktop E2E                |
| 默认 Project Task、Plan、Goal、文本模型降级 | PASS | Unit + Desktop E2E         |
| Goal 暂停/恢复/阻塞/重试与 doneWhen         | PASS | Component + orchestration  |
| Permission 三档、路径内外与 L4 强制审批     | PASS | UI + runtime unit          |
| Project 移动/重绑/重启与 Unicode 路径       | PASS | project/workspace unit     |
| Agent 活动、审批、取消、恢复与过期请求      | PASS | Desktop E2E + unit         |
| Usage 与 Composer Token 移除                | PASS | E2E                        |
| Diagnostics 脱敏导出                        | PASS | E2E                        |
| Web/VS Code/CLI 构建                        | PASS | production builds          |
| Desktop arm64 构建、打包与原生关键交互      | PASS | 当前 `.app`/DMG；重建前 AX |
| 自动验证退出码/超时/取消与大输出命令        | PASS | Unit + Rust 37/37          |

## 限制

当前运行未覆盖真实外部 Provider、外部 MCP、Windows、Intel 实机、商店发布、Developer ID 签名/公证和 VoiceOver。使用精确 release bundle 路径后，原生 Accessibility Tree、添加供应商入口、设置打开与 Escape 关闭均已实际验证；随后为安全修复重建的最终包有构建/签名证据，但当前会话缺少 `computer-use` 所需的 `node_repl`，未重复执行最终包点击，因此两类证据不混写。
