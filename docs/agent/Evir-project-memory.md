# Evir Project Memory — 当前事实索引

> Scope: 仅适用于 Evir 仓库。本文件是**高密度当前事实索引**，不创建新事实，不承载历史。
> 产品逻辑最终来源：`docs/01-product-requirements.md`；架构：`docs/02`；主题路由：`docs/README.md`。
> 历史与逐轮 Changelog：`docs/archive/`（Git 承担其余历史职责）。
> Last reviewed: 2026-09-02（Product UX Acceptance 轮）

## 1. Product Identity

本地优先、BYOM 的多模型 AI 客户端与通用桌面 Agent。同一代码库产出四个产品面：Web（静态聊天客户端）、Desktop（Tauri 2 Agent，主体产品）、VS Code 扩展（Preview）、CLI（Preview）。无账号、无积分、无广告、无强制云端后端；接入一个支持 Tool Calling 的模型即可使用全部核心能力。

## 2. Current Product Model（唯一当前心智）

- **Standalone Chat（侧栏 CHATS 区）**：纯聊天 / Ask，恒不触碰本地文件与项目。无模式控件。
- **Project（侧栏 PROJECTS 区）**：一个 Project 绑定一个本地目录。默认**普通 Task**：模型自行判断是否需要工具，需要时自动使用 Agent 执行能力。Agent 是**底层执行能力，不是用户必须理解的一级模式**。
- **Plan / Goal**：项目线程内仅有的两个显式**特殊工作方式**。Plan = 只读检查（L1）产出结构化计划，一键 Execute Plan 转 Agent 执行；Goal = 长期目标 + doneWhen 完成条件，完成判定必须来自证据而非模型文字。
- **权限档位（Project 级）**：ask（默认，写操作逐次审批）/ workspace / full（首开必须明确确认）。工具边界在 Tool Registry 与 Rust 侧双层强制，不靠提示词。
- 无 Tool Calling 的模型在 Project 中仍可聊天，但不获得项目工具，Plan/Goal 禁用并说明原因。
- **多任务运行时（2026-09-02 起）**：流槽位/停止 epoch/待审批均按 conversationId 键控（`streamSlots`/`streamEpochs`/`pendingApprovals` 为真相，平铺 isStreaming 等字段仅为当前视图镜像）；AbortController 与编排快照同样按会话分组——`stopGeneration(id)` 只停一个任务，其他任务继续流式/准备/等审批；发送守卫为 per-conversation 提交锁。侧栏行显示实时状态（运行中/准备中/待审批/失败/新结果），状态投影与流内容解耦不重绘。
- **Workspace 面板（2026-09-02 起）**：Desktop 主窗口三栏 Navigation | Thread | Workspace；右栏五 Tab（产出/变更/文件/预览/浏览器）——产出为一等交付物列表（类型 chip+大小+时间，点击进类型化预览），与变更（Agent 修改）、文件（项目树）彻底分离；`WorkspaceResource` 统一资源模型驱动 activeResource/history/pin/resize；TaskOutput 与 Changes 由真实工具执行+快照推导并随 run 持久化（run workspace store 按会话键控，多任务不串扰）；Result Summary 卡片（查看产出/查看变更入口）；工具卡按检查/修改/命令/浏览器聚合折叠；聊天大 artifact 改道右栏（`artifacts` 实体）；面板浏览器 = 主窗口子 webview（零能力，浮层经 overlayBlockers 隐藏），本地导航先探测可达性、拒绝连接显示错误卡+重试，Agent 使用页面时工具栏出 chip；预览 Tab 空态提供「预览应用」一等入口（检测启动脚本→Starting→Ready→自动开页切浏览器 Tab；ask 档确认保留）；dev server 生命周期由 Rust `dev_server.rs` 管理（ready 探测 + 退出清理 + `npm_config_verify_deps_before_run=false` 防 pnpm 隐式 install）；工作区在 <1440px 视口转为右侧抽屉，面板宽度钳制保证对话列 ≥460px；对话正文全链 `overflow-wrap:anywhere`。独立聊天隐藏产出/变更/文件 Tab。

## 3. Current Architecture Boundaries

- 依赖方向：Types → Config → Repository → Service → Runtime → UI。UI 不得直接调用 Provider SDK、Tauri 命令、SQLite、Shell、Keychain、MCP 进程或日志文件（走 Port/Adapter）。
- 存储：Feature stores 统一经 `StoragePort`；Web = IndexedDB（Dexie），Desktop = SQLite（`app_entities` 结构化实体，位于 `~/Library/Application Support/com.zihan.evir/evir.db`；providers/projects/conversations/messages/run 系列等）。
- 工作目录单一真相：`core/workspace/active-root`；Run 期压栈，整跑与审批续跑绑定 originating root，切项目不污染活动 Run。
- Provider 三层分离：Preset（36 家）→ Protocol Adapter（7 种已实现：OpenAI Chat Completions / Responses、Anthropic Messages、Gemini、Azure OpenAI、Ollama 原生、OpenAI-compatible）→ Model Profile。API Key 存本地加密 vault（Rust `secret_vault.rs`，AES-256-GCM + OS 用户绑定派生密钥；不再使用 OS 钥匙串——ad-hoc 重建会触发 ACL 弹窗），永不入日志。
- Harness 中间件（规范化/模式策略/能力门/上下文预算/Skill 路由/工具策略/循环检测/检查点/验证/可观测）各自可独立测试与移除；Tool Policy 是宿主保护项。

## 4. Runtime / Agent Model

- EvirRuntime 区分 Web/Desktop，按 Capability 注册工具；内置 13 个本地工具（read_file / write_file / list_directory / search_files / search_docs / apply_patch / file_stat / create_directory / create_snapshot / restore_snapshot / run_command / git_status / git_diff）。
- 风险分级 L0–L4；L3 逐次审批，L4 可禁用；工具来源标记 evir-local / mcp-local / mcp-remote / provider-server。
- 任务编排：task-intake 将目标分类为 answer / inspect / change / execute / mixed（中英文关键词，change 词优先于 inspect 词）；change 类生成 inspect→approval→execute→verify 计划图，**步骤级工具允许集**强制只读/可写边界（只读步骤内 write_file 会被诚实拒绝并反馈模型）。
- 循环检测 6 次警告 / 12 次停止；模型回合 120s 超时；上下文预算：<60% 不摘要，60–75% 归档工具输出，75–90% 摘要旧对话，>90% 强制检查点；摘要版本化。
- 模型切换经 ModelSwitchCoordinator + 安全检查点 + 数据去向确认；无跨 Provider 自动降级。

## 5. Current Capability Matrix

| 能力                                                     | 状态                                                                                         |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Web 聊天/附件/Skill(10)/导出                             | 已实现，稳定                                                                                 |
| Desktop 聊天/项目/工具/审批/快照/Diff/回滚/日志/诊断 ZIP | 已实现（原生 arm64 实测通过）                                                                |
| Plan / Goal / 权限档位 / 编排 DAG                        | 已实现（确定性链路原生实测；真实 Provider 长任务未验收）                                     |
| MCP Runtime（stdio + Streamable HTTP）                   | 已实现；Agent 会话内审批取证与 HTTP CORS 策略待办                                            |
| 智能任务编排/子 Agent                                    | 已实现（确定性部分）；真实 Provider 完整任务未验收，不标发布完成                             |
| VS Code 扩展                                             | **Preview**（配置/Ask/Agent/审批/Diff 回滚可用；Marketplace/High Contrast/完整本地化未完成） |
| CLI                                                      | **Preview**（configure/doctor/ask/agent 可用；错误友好度/退出码/i18n 未收口）                |
| 通知、命令面板、应用内帮助                               | 未实现                                                                                       |

## 6. Current Test Baseline（2026-09-02，UX Acceptance 轮门禁全绿）

- `pnpm check`（format + ESLint + strict `tsc -b` + vitest + release workflow 校验 + VS Code + CLI）：**876 TS** 用例 / **8 VS Code** / **8 CLI** 全过。
- `pnpm test:rust`：**66 Rust** 用例全过；cargo fmt / clippy 干净。
- E2E core（fixture，web+desktop）：42 过 / 10 能力跳过（含并发双任务停止隔离用例）；UI 矩阵 2/2、视觉 6/6、a11y 18/18、stress 7 过/1 跳（2026-09-02 全量重跑）。
- Benchmark 预算全过：Web 初始 gzip 325.6 KiB、桌面前端 14.71 MiB（`docs/benchmarks/latest.json`）。
- 原生 macOS arm64 实测（release 构建）：冷启动 0.84s、空闲内存 ~71 MB、空闲 CPU 0%。
- 逐项验证状态与 NOT RUN 清单：**以 `docs/release-readiness.md` 为准**（不要凭记忆引用旧数字）。

## 7. Known Release Blockers

1. **LICENSE：BLOCKED**——仓库 public 但无许可证文件，须由项目负责人在 MIT / Apache-2.0 / GPLv3 / AGPLv3 中决定，禁止代选。
2. Windows 全量验收 NOT RUN（安装/路径/Shell/凭据库/升级）。
3. VS Code Marketplace publisher 与 CLI npm 发布通道未配置。
4. 30–60 分钟 Agent 长任务、20–50 轮长对话原生实测 NOT RUN。

已知非阻塞事项：密钥自 2026-08-28 起存本地加密 vault（重建无弹窗）；既有钥匙串旧密钥不自动迁移，用户需重新输入一次。已知未修小缺陷：Provider“设为默认”被系统弹窗拒绝后可能出现双 `isDefault=true`（低概率，建议补事务性修复）。

## 8. Canonical Documentation

主题 → 权威文档映射见 `docs/README.md`。关键：产品=docs/01，架构=docs/02，测试策略=docs/testing.md，验证状态=docs/release-readiness.md，发布门禁=AGENTS.md。`docs/archive/`、`docs/reviews/`、`docs/references/` 一律为历史/参考资料，不是规范来源。

## 9. Important Development Constraints

- TypeScript strict；禁 `any`/空 catch/万能 Store；组件/Hook/模块 ≤600 行、函数 ≤200 行；外部输入 Zod 验证；长任务支持 AbortSignal。
- 永不记录 API Key/Authorization/Cookie/环境变量/完整会话/文件正文；日志本地、脱敏、有界（app/audit/performance 分类 JSONL，15MB 轮转/14 天/100MB 预算）。
- 不得用 Mock/Port/静态 UI 冒充功能完成；模型文字不能标记任务完成，须验证证据；取消的 Run 不得显示完成。
- 测试触达用户数据时的约定：先备份（cp evir.db*），测后 SQL 清痕并还原默认；绝不消耗用户真实 Provider 配额（用本地 fixture 服务器，`e2e/fixtures/provider-server.mjs` 支持 `[agent-task]`/`[agent-recovery]` 脚本化 tool_calls）。
- PR 门禁：`pnpm check` + `pnpm test:rust`（CI 在 PR/main 自动执行；打包与签名仅 tag 阶段）。
