# docs 导航 — 主题与权威来源（Canonical Sources）

一个主题只有一个权威来源。改代码前：先读根目录 `AGENTS.md`，再按本表找到**与任务直接相关的那一份**文档即可，不需要每次加载全部文档。

## 当前状态与基线

| 要找什么                         | 去哪里                                                                                           |
| -------------------------------- | ------------------------------------------------------------------------------------------------ |
| 项目是什么、安装使用             | 根目录 `README.md` / `README.en.md`                                                              |
| 当前门禁基线、实现状态、已知缺口 | [`agent/Evir-project-memory.md`](agent/Evir-project-memory.md)（高密度索引，细节以原始文档为准） |
| Coding Agent 规范                | 根目录 `AGENTS.md`                                                                               |

## 正式文档（当前规范）

| 主题                                                          | 权威文档                                                                                                                                 |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| 产品需求与当前信息架构（Projects/Chats、Plan/Goal、权限档位） | [`01-product-requirements.md`](01-product-requirements.md)                                                                               |
| 系统架构与分层                                                | [`02-technical-architecture.md`](02-technical-architecture.md)                                                                           |
| 开发指南（构建/发布/环境）                                    | [`03-development-guide.md`](03-development-guide.md)                                                                                     |
| 设计规范（视觉/交互/i18n/无障碍）                             | [`04-design-specification.md`](04-design-specification.md)                                                                               |
| 工程标准（行数预算/门禁/代码质量）                            | [`05-engineering-standards.md`](05-engineering-standards.md)                                                                             |
| 开发计划与进度史                                              | [`06-development-plan.md`](06-development-plan.md)                                                                                       |
| Agent 安全与质量                                              | [`07-agent-security-and-quality.md`](07-agent-security-and-quality.md)                                                                   |
| Skill 与 MCP 产品规范                                         | [`08-skill-and-mcp.md`](08-skill-and-mcp.md)                                                                                             |
| 存储、产物与恢复                                              | [`09-storage-artifacts-and-recovery.md`](09-storage-artifacts-and-recovery.md)                                                           |
| 流式与性能                                                    | [`10-streaming-and-performance.md`](10-streaming-and-performance.md)                                                                     |
| Provider 权限与可观测性                                       | [`11-provider-permissions-and-observability.md`](11-provider-permissions-and-observability.md)                                           |
| 产品闭环评审方法论                                            | [`12-product-closure-review.md`](12-product-closure-review.md)（含历史标记）                                                             |
| Provider 与协议矩阵                                           | [`13-provider-and-protocol-matrix.md`](13-provider-and-protocol-matrix.md)                                                               |
| 个性化/通知/快捷键                                            | [`14-personalization-notifications-usage-shortcuts-feedback-help.md`](14-personalization-notifications-usage-shortcuts-feedback-help.md) |
| 模型切换与上下文最终体验                                      | [`15-final-experience-model-switching-and-context.md`](15-final-experience-model-switching-and-context.md)                               |
| Harness 工程                                                  | [`16-harness-engineering-for-evir.md`](16-harness-engineering-for-evir.md)                                                               |
| 本地日志与诊断                                                | [`17-local-logging-and-diagnostics.md`](17-local-logging-and-diagnostics.md)                                                             |
| 产品评审 v6（验收口径）                                       | [`18-final-product-review-v6.md`](18-final-product-review-v6.md)                                                                         |
| VS Code 扩展路线                                              | [`19-vscode-extension-and-editor-roadmap.md`](19-vscode-extension-and-editor-roadmap.md)                                                 |
| CLI 产品与技术规格                                            | [`20-cli-product-and-technical-specification.md`](20-cli-product-and-technical-specification.md)                                         |
| Component Runtime                                             | [`21-composable-component-runtime.md`](21-composable-component-runtime.md)                                                               |
| MCP Runtime 实现（§9 为当前状态）                             | [`22-mcp-runtime-implementation-plan.md`](22-mcp-runtime-implementation-plan.md)                                                         |
| 全项目测试用例与执行记录                                      | [`23-full-project-test-cases.md`](23-full-project-test-cases.md)                                                                         |
| 高级 Agent 能力清单与边界                                     | [`advanced-agent-capabilities-plan.md`](advanced-agent-capabilities-plan.md)                                                             |

## 参考与历史（不是规范）

| 位置                                               | 内容                                                        |
| -------------------------------------------------- | ----------------------------------------------------------- |
| [`references/`](references/)                       | Harness Engineering 外部资料原文                            |
| [`reviews/`](reviews/)                             | 2026-08-06/07/11 QA 快照与 VS Code/CLI 评审（均带历史标记） |
| [`archive/`](archive/)                             | 根目录一次性报告与已被取代的设计文档（2026-08-28 移入）     |
| `../prompts/`                                      | 项目启动期历史 Prompt                                       |
| [`benchmarks/latest.json`](benchmarks/latest.json) | 最近一次产物体积基准                                        |
