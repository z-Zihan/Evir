# Evir 文档体系审计报告

> 审计日期：2026-08-27 · 基线：main 分支 3e8bebd 工作树
> 审计原则：代码是功能事实来源，测试是行为证据，文档必须描述真实产品。
> 本报告先于任何文档修改完成；文末「执行记录」记载实际落地的修改。

## Executive Summary

全仓共审计 **48 个 Markdown 文档**（docs/ 34、根目录 8、help/ 2、design/ 3、prompts/ 1，另核验 extensions/vscode 与 packages/cli 各自 README）。总体结论：

1. **存在一次大规模「文档落后于代码」的产品模型漂移**：2026-08-27 的 Project/Chat/Agent 信息架构重构（Sidebar PROJECTS/CHATS、Project 一等实体、Composer 内 Agent/Plan/Goal 三模式、Permission Profiles ask/workspace/full、active-root 运行隔离）已完整落地，但 **约 12 份当前规范文档**（README 中英、docs/01/02/04/06/11/15/18/23、help/ 中英、AGENTS.md）仍描述重构前的旧模型（「Desktop 默认 Agent 可切换 Ask」「Plan 非一级模式」「工作区入口在输入区附近」）。
2. **存在一处面向公众的不实「已实现」声明**：README 中英文均用现在时写「用户可在设置中导出诊断 ZIP」，实际代码只有 JSON 下载，`DiagnosticExportPort` 仅有接口、无任何实现。经用户授权，本次**直接实现该功能**（见执行记录），而不是把文档改弱。
3. **MCP 状态声明互相矛盾**：MCP Runtime（stdio + Streamable HTTP、发现、调用、审批、重连）已于 2026-08-15 实现，但 README/help 仍写「仍在开发中」，而项目记忆文件内部同时存在「已实现」与「未实现」两段自相矛盾的记录。
4. 无删除级过时文档被证明安全删除：所有候选（历史评审、旧 Prompt、阶段报告）要么仍被引用，要么有历史决策价值，全部以**标记 Historical / 更新**处理，**删除数为 0**。

## Documentation Inventory

| 区域                                                                        | 文档数 | 性质                                          |
| --------------------------------------------------------------------------- | ------ | --------------------------------------------- |
| docs/01-23 编号规范                                                         | 23     | 产品/架构/设计/工程/计划/专项规范与测试用例   |
| docs/ 专项（advanced-agent-capabilities-plan、project-chat-agent-redesign） | 2      | 2026-08-13/08-27 两个新增能力的设计与实施文档 |
| docs/agent/Evir-project-memory.md                                           | 1      | Coding Agent 强制前置阅读的项目记忆索引       |
| docs/references/                                                            | 2      | 外部参考资料快照                              |
| docs/reviews/                                                               | 7      | 自动化质量/缺陷登记/UI QA/页面清单/评审证据   |
| 根目录报告（ADVANCED_AGENT__、PROJECT_CHAT_AGENT__）                        | 5      | 2026-08-27 两轮开发的变更与回归证据           |
| README.md / README.en.md / AGENTS.md                                        | 3      | 产品首页（中/英）与 Coding Agent 入口         |
| help/zh-CN.md、help/en.md                                                   | 2      | 面向用户的离线帮助                            |
| design/                                                                     | 3      | 视觉审计 / MCP 设计 context / 记忆 QA 证据    |
| prompts/coding-agent-master-prompt.md                                       | 1      | 项目启动时的 Coding Agent 总 Prompt（历史）   |

每份文档的逐条分类（A-Current / B-Needs Update / C-Needs Merge / D-Historical / E-Obsolete / F-Evidence）：

| 文档                                                                   | 分类        | 主要问题                                                                                                                                         |
| ---------------------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| README.md / README.en.md                                               | B           | 旧模式模型；MCP「仍在开发」不实；诊断 ZIP 现在时不实；en 版把「Optional system notifications」列在"已具备的基础体验"下与 zh 版「尚未提供」不一致 |
| AGENTS.md                                                              | B           | 「model, Ask/Plan/Agent」未含 Goal/Permission/Project 词汇                                                                                       |
| docs/01-product-requirements.md                                        | B           | §5 Modes 三模式；§11 权限预设用旧词汇（安全/标准/自动/自定义）；§19 诊断 ZIP 规格级未标状态；§20 整节是重构前边界                                |
| docs/02-technical-architecture.md                                      | B           | §10 核心实体缺 `projects`；§13 运行模式未含 goal/Project Thread/Permission Profile；§20 DiagnosticExportService 为目标态                         |
| docs/03-development-guide.md                                           | A           | 无产品模型声明，命令与发布矩阵与实际一致                                                                                                         |
| docs/04-design-specification.md                                        | B           | §3 信息架构「Sidebar 会话/任务」；§13「相同的 Ask/Agent 术语」；§16「Desktop 才显示 Ask/Agent…工作区上下文在输入区附近」均为旧模型               |
| docs/05-engineering-standards.md                                       | A           | 章节编号重复（两个 §13）需修；其余有效                                                                                                           |
| docs/06-development-plan.md                                            | B           | S4 验收「Plan 不作为一级模式」与重构相反；缺 2026-08-27 重构与 08-27 advanced-agent 轮次条目；MCP 表述过时                                       |
| docs/07-agent-security-and-quality.md                                  | A           | L0-L4 与 Permission Profiles 正交兼容                                                                                                            |
| docs/08-skill-and-mcp.md                                               | A           | 与已实现 MCP Runtime 一致                                                                                                                        |
| docs/09-storage-artifacts-and-recovery.md                              | B           | 核心实体缺 `projects`（Dexie v8/SQLite/Rust allowlist 已有）                                                                                     |
| docs/10-streaming-and-performance.md                                   | B(轻)       | §6 快照停留 2026-08-06；预算声明诚实                                                                                                             |
| docs/11-provider-permissions-and-observability.md                      | B           | §6 三模式；§7 旧权限预设词汇                                                                                                                     |
| docs/12-product-closure-review.md                                      | D(方法论 A) | §9.6/§2.1 旧模型；§10「MCP Runtime 仍是发布前门槛」过时                                                                                          |
| docs/13-provider-and-protocol-matrix.md                                | A           | 头部已声明「不代表全部已接入」；矩阵与 7 个已实现 Adapter 一致                                                                                   |
| docs/14-personalization-notifications-usage-shortcuts-feedback-help.md | B(轻)       | §2 设置树「Agent：默认模式、权限」——实际设置页 13 个 tab 无 Agent 分类，权限已迁 Project 级                                                      |
| docs/15-final-experience-model-switching-and-context.md                | B           | §3 主界面三模式；§4.3 Handoff mode 联合缺 goal；§2.1「首次需要时选择工作区」                                                                     |
| docs/16-harness-engineering-for-evir.md                                | A           | §2.1 措辞轻微（Ask/Plan/Agent 未含 goal）                                                                                                        |
| docs/17-local-logging-and-diagnostics.md                               | B           | 全文目标态「应然」，未区分已实现（FileLogSink 分类 JSONL/轮转/预算）与未实现（诊断 ZIP→本次实现后更新、GitHub 反馈流程、详细模式开关）           |
| docs/18-final-product-review-v6.md                                     | B           | §3.4「文件级日志尚未实现」已过时（FileLogSink 已实现）；§2.1/§4 旧模式；§8「MCP Runtime 原生验收尚未验收」过时                                   |
| docs/19-vscode-extension-and-editor-roadmap.md                         | A           | 边界与缺口描述与实现一致                                                                                                                         |
| docs/20-cli-product-and-technical-specification.md                     | A           | 明确区分目标与当前实现                                                                                                                           |
| docs/21-composable-component-runtime.md                                | A           | 与代码一致                                                                                                                                       |
| docs/22-mcp-runtime-implementation-plan.md                             | D+F         | §1-8 为实施前计划（历史），§9 实现状态与原生物证准确；未被任何文档引用（孤立）                                                                   |
| docs/23-full-project-test-cases.md                                     | B           | ENV-003 仍断言旧模式；缺 Project/Sidebar/Permission/Goal 用例；GUI 编号体系（GUI-001..054）与执行记录结构完好                                    |
| docs/advanced-agent-capabilities-plan.md                               | A           | 与 ADVANCED_AGENT_* 报告配套                                                                                                                     |
| docs/project-chat-agent-redesign.md                                    | A           | 重构事实来源，与代码一致（Current State 一节是有意的历史对比）                                                                                   |
| docs/agent/Evir-project-memory.md                                      | B           | 头部日期停在 2026-08-07；§4「MCP Runtime 尚未实现」vs §10「已实现」自相矛盾；§17 未实现列表含 MCP 与文件级日志（均过时）；§19/§21 旧模式声明     |
| docs/references/*                                                      | F           | 外部资料快照，无漂移概念                                                                                                                         |
| docs/reviews/automated-quality-report.md                               | F           | 数字过时（298 tests/271KB），属阶段证据                                                                                                          |
| docs/reviews/stability-bug-register.md                                 | F           | 全部已修复；EVIR-S-006 是旧 IA 历史记录                                                                                                          |
| docs/reviews/ui-ux-stability-review.md                                 | D           | L9 旧模式声明                                                                                                                                    |
| docs/reviews/ui-component-state-matrix.md                              | F           | 含已移除的 WorkspaceSelector 行（历史证据）                                                                                                      |
| docs/reviews/ui-full-qa-bug-register.md                                | F           | L27「MCP runtime not implemented」已过时                                                                                                         |
| docs/reviews/ui-full-qa-report.md                                      | F           | B/H 节旧模型与 MCP 状态                                                                                                                          |
| docs/reviews/ui-page-inventory.md                                      | F           | UI-009 WorkspaceSelector、UI-018 MCP Partial 过时                                                                                                |
| docs/reviews/vscode-cli-product-ui-review.md                           | A(F)        | 缺口清单与现状一致                                                                                                                               |
| help/zh-CN.md、help/en.md                                              | B           | 4 处漂移：默认模式、Plan 非一级、工作区入口位置、MCP/文件日志状态                                                                                |
| design/audit.md                                                        | F           | 2026-08-27 当前视觉审计                                                                                                                          |
| design/context.md、design/qa.md                                        | F           | 历史设计 context 与 QA 记录                                                                                                                      |
| prompts/coding-agent-master-prompt.md                                  | D           | 启动期总 Prompt；指向不存在的 `docs/decisions/`；行数上限与 docs/05 现行值冲突                                                                   |
| 根目录 ADVANCED_AGENT_* / PROJECT_CHAT_AGENT_*                         | F/A         | 2026-08-27 真实回归证据，与代码一致                                                                                                              |

## Current Documents（无需修改）

docs/03、docs/07、docs/08、docs/13、docs/19、docs/20、docs/21、docs/advanced-agent-capabilities-plan、docs/project-chat-agent-redesign、docs/references/README、design/audit、ADVANCED_AGENT_CHANGELOG、extensions/vscode/README、packages/cli/README。

## Documentation ↔ Code Gap

### Docs claim implemented, code does not

| #   | 文档                               | 声明                                                                                                                  | 实际                                                                                                                                                   | 证据                      | 处理                                                                            |
| --- | ---------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------- | ------------------------------------------------------------------------------- |
| 1   | README.md L175 / README.en.md L150 | 「用户可在设置中导出诊断 ZIP」（现在时）                                                                              | 仅 JSON 下载（`DiagnosticsSettings.tsx` L42-43）；`DiagnosticExportPort` 仅接口（`src/core/logging/diagnostic-port.ts`），全仓无实现；Rust 无 zip 命令 | 代码检索                  | **实现**（用户授权的好功能：docs/01 §19、docs/02 §20、docs/17 §10-12 均有规格） |
| 2   | README.en.md L132                  | 「Optional system notifications for long-run completion, approvals, and failures」列在"Complete everyday foundations" | `NotificationPort` 仅类型（`src/core/notifications/types.ts`），无实现/UI；zh 版如实写「尚未提供」                                                     | 代码检索                  | 修文案与 zh 对齐（不实现——非核心路径）                                          |
| 3   | docs/01 §11 / docs/11 §7           | 权限预设「安全/标准/自动/自定义」                                                                                     | 实际为 Project 级 `ask/workspace/full` + Additional Access Roots（`src/core/security/permission-profiles.ts`）                                         | 代码                      | 更新词汇                                                                        |
| 4   | docs/14 §2                         | 设置树含「Agent：默认模式、权限」                                                                                     | 设置页 13 tab 无 Agent 分类；权限入口在 Project（`ProjectPermissionPanel.tsx`）                                                                        | SettingsModal.tsx L60-120 | 更新                                                                            |

### Code implemented, docs missing

| #   | 功能                                                                                                      | 实现证据                                                                                | 缺失文档                                             | 建议位置                                                                                |
| --- | --------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ---------------------------------------------------- | --------------------------------------------------------------------------------------- |
| 1   | Sidebar PROJECTS/CHATS + Project 一等实体（UUID、realpath 去重、重绑保 ID、threads 迁移）                 | `src/app/Sidebar.tsx`、`src/features/projects/project-store.ts`、Dexie v8 `projects` 表 | docs/02 §10、docs/09 §3 实体表；README               | 更新实体列表 + README                                                                   |
| 2   | Composer 内 Agent/Plan/Goal 一等三模式 + Standalone 恒 ask + Execute Plan                                 | `src/app/ModeSwitcher.tsx`、`ChatView.tsx` L470-489、`conversation-mode.ts`             | README、docs/01/04/06/11/15/18/23、help/*、AGENTS.md | 统一到 redesign 词汇                                                                    |
| 3   | Permission Profiles（ask/workspace/full、additional roots、full 首开确认、permission.auto-approved 审计） | `permission-profiles.ts`、`ProjectPermissionPanel.tsx`、executor 接入                   | README、docs/01 §11、docs/11 §7                      | 同上                                                                                    |
| 4   | active-root 运行隔离（run 期压栈、审批续跑绑定 originating root、切项目不污染运行中 Run）                 | `src/core/workspace/active-root.ts`                                                     | docs/15                                              | 补充说明                                                                                |
| 5   | MCP Runtime（stdio 持久子进程 + Streamable HTTP、发现、调用、审批、重连）                                 | `src/core/mcp/*`、`src-tauri/src/mcp_stdio*.rs`、32 个测试                              | README/help 仍写「开发中」                           | 更新为已实现 + 剩余缺口（Agent 会话内审批取证、WebView CORS、外部真实 Server、Windows） |
| 6   | Goal 模式（doneWhen 解析/评估、goal-budget、TaskWorkbench 目标横幅、auto re-plan）                        | `send-message.ts`、`done-when.ts`、`goal-budget.ts`、`TaskWorkbench.tsx`                | docs/06 无轮次条目；README                           | 补记                                                                                    |
| 7   | Git worktree 并行写（create/merge/remove）                                                                | `src-tauri` L59-61 + 调度接入                                                           | 无文档                                               | docs/06/memory 补记                                                                     |
| 8   | `search_docs` 工具（13 内置工具之一）                                                                     | `local-file-tools.ts`                                                                   | 工具清单未列                                         | memory/相关文档                                                                         |
| 9   | 文件日志持久化 + 诊断页持久化状态展示                                                                     | `file-log-sink.ts`、`DiagnosticsSettings.tsx`                                           | docs/18 §3.4 仍写「文件级尚未实现」                  | 更新                                                                                    |

### Docs conflict with docs

| #   | 文档 A                                                                                            | 文档 B                                                                                     | 当前事实                  | 解决                     |
| --- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------- | ------------------------ |
| 1   | README/docs/01/04/06/11/15/18/23/help/AGENTS.md：「Plan 非一级模式；Desktop 默认 Agent 可切 Ask」 | docs/project-chat-agent-redesign.md：「Plan 一等模式；Composer 三模式；Standalone 恒 ask」 | 代码 = redesign 文档      | 以 redesign 为准统一全部 |
| 2   | README/help：「MCP 连接仍在开发中」                                                               | docs/08/docs/22 §9/memory §10：「Runtime 已实现」                                          | 已实现（剩 4 项缺口）     | 统一为已实现 + 缺口      |
| 3   | docs/01 §11 / docs/11 §7 权限预设词汇                                                             | redesign §Permission Matrix（ask/workspace/full）                                          | 代码 = ask/workspace/full | 统一                     |
| 4   | memory §4/§17「MCP 未实现、文件级日志未实现」                                                     | memory §10/§13/§20「已实现」                                                               | 已实现                    | 修 memory 内部矛盾       |
| 5   | prompts/coding-agent-master-prompt.md 行数上限 250/200                                            | docs/05 现行 600/200                                                                       | 600/200                   | prompts 标记 Historical  |

### Planned presented as current

1. 诊断 ZIP（README 现在时）——处理方式：**实现它**（见执行记录）。
2. docs/17 整体为「应然」规范，未标注哪些章节已实现——补实现状态标注。
3. 性能数字总体诚实：README/docs/10 均标「目标/预算」；仅各文档快照数字陈旧不一致（271/277.5/280/320 KiB），统一引用 `docs/benchmarks/latest.json`。

## Product Model Drift（Stale Product Model）

重构前旧模型（「顶部/应用级 Ask-Agent 切换；Workspace 输入框选择；Plan 内部阶段；Conversation 无归属」）残留于 14 处当前规范文档，是本次审计最大的一类漂移。新模型六正交概念（Project 决定在哪里工作 / Chat 只聊天 / Thread 连续上下文 / Mode 决定怎么工作 / Permission 决定自动程度 / Model 决定由谁工作）以 `docs/project-chat-agent-redesign.md` + 代码为唯一事实来源。

## Platform Capability Matrix

| Capability                             | Web        | Desktop                  | VS Code           | CLI        | Status                                                        | Evidence                                |
| -------------------------------------- | ---------- | ------------------------ | ----------------- | ---------- | ------------------------------------------------------------- | --------------------------------------- |
| Chat（流式/停止/Markdown/附件/多会话） | ✅         | ✅                       | ✅                | ✅(ask)    | Implemented                                                   | 7 个协议 Adapter、`adapter-registry.ts` |
| 附件                                   | ✅         | ✅                       | ❌                | ❌         | Implemented（按端）                                           | `src/features/chat/attachment-*`        |
| 本地文件工具（13 内置）                | ❌         | ✅                       | 子集              | 子集       | Implemented                                                   | `local-file-tools.ts`、workspace-tools  |
| Shell                                  | ❌         | ✅(run_command)          | ✅(审批)          | ✅(审批)   | Implemented                                                   | `run_command`/CLI approval              |
| Git                                    | ❌         | ✅(status/diff/worktree) | ✅(只读)          | ❌         | Implemented                                                   | `git_*` 命令                            |
| Agent 模式                             | ❌         | ✅                       | ✅                | ✅         | Implemented                                                   | ModeSwitcher/extension/CLI              |
| Plan 模式（L1 只读 + Execute Plan）    | ❌         | ✅                       | ❌                | ❌         | Implemented                                                   | `MODE_TOOL_RISK_LIMITS`                 |
| Goal 模式（doneWhen/预算/横幅）        | ❌         | ✅                       | ❌                | ❌         | Implemented                                                   | `done-when.ts`、`goal-budget.ts`        |
| Project 实体/Sidebar 两区              | ❌         | ✅                       | ❌                | ❌         | Implemented                                                   | `project-store.ts`、Dexie v8            |
| Permission Profiles                    | ❌         | ✅                       | 逐次审批          | 逐次审批   | Implemented                                                   | `permission-profiles.ts`                |
| 审批（Approve/Deny/审计）              | ❌         | ✅                       | ✅                | ✅         | Implemented                                                   | `tool-approval.ts`                      |
| 快照/回滚                              | ❌         | ✅                       | 最后一次写入      | ❌         | Implemented                                                   | snapshot 工具/change-tracker            |
| Skills                                 | 指令型(10) | ✅(36)                   | ❌                | ❌         | Implemented                                                   | `skill-registry.ts`                     |
| MCP                                    | ❌         | ✅(stdio+HTTP)           | ❌                | ❌         | Implemented（剩取证/CORS/Windows 缺口）                       | `src/core/mcp/*`                        |
| 记忆/压缩/Checkpoint/崩溃恢复          | ❌         | ✅                       | ❌                | ❌         | Implemented                                                   | `src/core/memory`、`crash-recovery.ts`  |
| 上下文压缩                             | n/a        | ✅                       | ❌                | ❌         | Implemented                                                   | `conversation-summarizer.ts`            |
| 日志文件持久化                         | ❌(内存)   | ✅(JSONL)                | OutputChannel     | stderr     | Implemented                                                   | `file-log-sink.ts`                      |
| 诊断导出                               | JSON       | JSON→**ZIP（本次实现）** | ❌                | ❌         | 见执行记录                                                    | `DiagnosticsSettings.tsx`               |
| 系统通知                               | ❌         | ❌                       | ❌                | ❌         | Planned（仅端口）                                             | `notifications/types.ts`                |
| 命令面板                               | ❌         | ❌(已移除死代码)         | ❌                | ❌         | Planned                                                       | —                                       |
| 浏览器自动化 / Computer Use            | ❌         | ❌(死代码未注册)         | ❌                | ❌         | Planned                                                       | `browser-tools.ts` 未引用               |
| Provider 协议                          | 7 种       | 7 种                     | OpenAI-compatible | 同 Desktop | Implemented（15 种 ID 中 8 种待实现：Bedrock/Mistral 原生等） | `adapter-registry.ts`                   |
| VS Code AgentActivity 呈现             | —          | —                        | ❌                | —          | Partial（发布前缺口）                                         | docs/19                                 |
| CLI 中英文/JSON 输出                   | —          | —                        | —                 | ❌         | Planned                                                       | docs/20                                 |

## Broken / Stale Links

1. `prompts/coding-agent-master-prompt.md` L46 指向不存在的 `docs/decisions/` 目录。
2. `docs/22`、`docs/23`、`help/*`、`design/*` 未被任何 Markdown 引用（孤立但非死链）。
3. README 文档导航缺 docs/21/22/23、project-chat-agent-redesign、advanced-agent-capabilities-plan 入口。
4. 未发现指向已删除文件的相对链接死链（`docs/benchmarks/latest.json`、`e2e/snapshots/` 均存在）。

## Documents Deleted

**0。** 所有删除候选（历史评审报告、旧启动 Prompt、阶段报告）要么被 README/AGENTS.md/docs 交叉引用，要么承载历史决策证据，不满足「内容失效 + 无当前用途 + 无历史价值 + 无引用」的删除条件。处理方式为标记 Historical 或在文中修正过时声明。

## Remaining Uncertainty

1. VSCodium/Cursor/Windsurf 安装同一 VSIX「尚未逐项验收」——保持原样，无法在本环境验证。
2. Desktop 冷启动/空闲内存/CPU/安装包体积从未正式测量——所有文档保持「目标/预算」措辞，不改为已达成。
3. Windows 构建、真实 Tag Release、Marketplace/Open VSX 发布——仍为未验收项，保留。
4. browser-tools.ts 为未注册死代码：与「后续阶段」的 README 声明一致，本轮不动代码，仅在记忆中记录。

---

## 执行记录（审计后实际落地，2026-08-27）

### 代码实现（用户授权：文档存在、代码缺失、功能有必要 → 补实现）

1. **诊断 ZIP 导出（新功能）**：
   - Rust：`src-tauri/src/diagnostics.rs` + `diagnostics_tests.rs`，新增 `diagnostics_logs_overview` / `diagnostics_export_zip` 命令（`zip` crate，deflate；manifest + 脱敏元数据 + logs/*.jsonl + 可选 crash/；文件名白名单防路径穿越；按天数过滤）。
   - TS core：`src/core/logging/diagnostics-bundle.ts`（纯构建器，递归 redactLogValue 脱敏 provider/MCP 元数据）+ 测试。
   - Runtime：`src/runtime/diagnostics-export.ts`（`DiagnosticExportPort` 首个真实适配器 `DesktopDiagnosticsExport`，保存对话框 + invoke）。
   - UI：`DiagnosticsSettings` 新增"导出诊断包 (ZIP)"（桌面专属；预览文件数/体积 → 确认 → 保存；取消/失败独立文案与日志事件），i18n 中英文。
   - 测试：Rust 25（+6）、TS 636（+4 bundle、+1 web 断言），clippy/fmt 干净。
2. **Sidebar 项目行 hover 动作不可见 bug 修复**（截图工作暴露的真实缺陷）：`.conversation-actions` 的 reveal 规则只覆盖 `.conversation-item`，且 `.project-row` 缺 `position:relative` 导致按钮绝对定位漂移到主区域且永不显示；已在 `shell.css` 补齐 `.project-item:hover/.active/:focus-within` 规则与定位上下文（该路径重构后原生走查为 NOT RUN，故未被发现）。

### 文档更新（14 份当前规范）

README.md、README.en.md（整体重写，见 README_REFRESH_REPORT.md）、AGENTS.md（必读清单 + 模式规则）、docs/01（模式/权限预设/§20 边界重写/诊断 ZIP 标注）、docs/02（实体表 +projects/编排实体、§13 运行模式、§20 诊断导出）、docs/04（§3 IA、§13 术语、§16 视觉基线）、docs/05（重复章节号 13→14..19 重排）、docs/06（S3/S4 加历史注记 + 三个 2026-08-27 轮次条目 + MCP/阶段 8 状态）、docs/09（实体表）、docs/10（性能快照更新并指向 latest.json）、docs/11（§6 四模式 + §7 权限档位）、docs/12（Historical 横幅 + §10 MCP 进展注记）、docs/14（设置树、快捷键清单改为实际 6 个、帮助主题）、docs/15（首路径、主界面、Handoff mode 联合、§7.1 验证状态）、docs/16（中间件措辞）、docs/17（实现状态横幅 + §10 诊断包结构）、docs/18（§3.4 日志状态、模式行、§8 MCP 进展）、docs/22（Historical/Current 分段横幅）、docs/23（ENV-003 新预期 + 新增 §4.14 PPG-001..013）、docs/agent/Evir-project-memory.md（头部基线、§4/§13/§17/§19/§21 矛盾修正、测试计数、新增文档轮条目与 Update Log）、help/zh-CN.md + help/en.md（全面重写：侧栏两区、四模式、权限档位、MCP 已实现、诊断 ZIP）。

### 标记 Historical / Evidence（9 份）

docs/reviews/ 下 7 份（automated-quality-report、stability-bug-register、ui-ux-stability-review、ui-component-state-matrix、ui-full-qa-bug-register、ui-full-qa-report、ui-page-inventory）与 prompts/coding-agent-master-prompt.md 加历史快照横幅并修复 `docs/decisions/` 死链；docs/12 决策史标注。

### 删除：0（无候选满足安全删除条件）

### 新增文件

`DOCUMENTATION_AUDIT_REPORT.md`、`README_REFRESH_REPORT.md`、`scripts/capture-readme-screenshots.mjs`、`assets/readme/{desktop-overview,project-permission,provider-settings,web-chat}.png`、`src-tauri/src/diagnostics{,_tests}.rs`、`src/core/logging/diagnostics-bundle.ts`、`src/runtime/diagnostics-export.ts`。

### 验证结果

- `pnpm check`（format:check + ESLint + strict TS + 636 vitest 全过 + release workflow 校验 + VS Code check + CLI check 8 tests）：**通过（exit 0）**。
- `cargo test`（25 passed）/ `cargo clippy --all-targets`（0 warning）/ `cargo fmt --check`：**通过**。
- 44 个 Markdown 文件的相对链接与图片路径扫描：**全部可解析，无死链**。
- 截图 4 张均来自当前代码真实 UI（确定性种子数据，无密钥/无测试串/无隐私路径），并可用 `node scripts/capture-readme-screenshots.mjs` 重复生成。
