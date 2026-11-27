# Evir 高级 Agent 能力：审计与实施计划

> 2026-08-27 · 事实来源：5b7fbbe 时的代码与测试（非文档声明）。

## Current Capabilities（代码审计结论）

### 已经完整存在（增强即跳过）

| 能力            | 真实实现                                                                                                                                                                                                                                                                           | 证据                                                   |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| Task Intake     | `TaskIntakeService` + `ModelTaskIntakeAnalyzer`（objective/goalKind/constraints/assumptions/unknowns/risk + 上下文-only 短路 + 近 8 轮对话上下文）                                                                                                                                 | task-intake.ts、model-task-intake-analyzer.ts、单测    |
| 动态澄清        | 结构化 `UnknownField`（question/impact/suggestedAnswers/answer），仅 blocking 级 impact 触发提问，最多 2 轮，问答入事件流                                                                                                                                                          | orchestration-session.ts、schema                       |
| Plan DAG        | `PlanGraph` 节点+边（when: success/failure/always），依赖就绪判定，revision 可见                                                                                                                                                                                                   | scheduler.ts、TaskWorkbench "Revision 1"               |
| 只读并行        | `GraphScheduler` 批次调度：就绪且资源不冲突的节点 `Promise.all`（maxParallelWorkers 1-4，默认 2）；read+read 永不冲突，同 workspace/git 写互斥 → **写天然串行**                                                                                                                    | scheduler.ts:130-160、scopesConflict                   |
| Sub Agent       | `subagent` 节点 → `AgentDispatcher`（depth=1 禁嵌套），`scopedRuntime` 收窄工具集，worker 模式按 scopes 定 plan(只读)/agent；上下文= nodeMessages（目标+依赖摘要，**非父会话全量**）；结构化 `WorkerReport`（summary/artifacts/verificationEvidence/unresolvedErrors，zod strict） | run-orchestrated-agent.ts:250-440、agent-dispatcher.ts |
| Supervisor      | 编排会话即协调者：建 plan/分配/收集/blocked→澄清/retry 保留已完成节点/审批回到用户                                                                                                                                                                                                 | orchestration-session.ts 全相位机                      |
| Execution Trace | 两层：TaskWorkbench 步骤时间线（用户层）+ 展开 execution details/工具执行记录（技术层）；数据全部来自 plan/snapshot/tool_executions 投影                                                                                                                                           | TaskWorkbench.tsx                                      |
| Verification    | 节点级 verification 节点+证据收集；运行级 `finalizeAutomaticVerification`（仅真实写变更触发）；无验证证据的 change 类 plan 不许 completed                                                                                                                                          | run-orchestrated-agent、verification-evidence          |
| 恢复            | checkpoint + findUnfinishedRuns + pause/resume + 快照持久化（不重放副作用工具）                                                                                                                                                                                                    | crash-recovery、orchestration repository               |
| Memory          | 三 scope（全局/工作区=项目/会话）+ 隐私会话 + 按相关性注入                                                                                                                                                                                                                         | memory-store、stream-response                          |

### 部分存在（本轮增强）

- **Goal + Done When**：doneWhen 解析与横幅展示存在，但 **不参与完成判定**（展示型清单）；且 `doneWhen` 不在 zod schema，持久化时被剥（重载丢失）。
- **运行级预算**：assignment 有 `{maxTurns:12}`，但无 Goal 级节点数/时长护栏。

### 尚未实现（本轮不做 / 明确排除）

- 偏好记忆候选（Preference Candidate UI）——Phase 4，不抢占核心闭环。
- 并行写 / Git Worktree —— Phase 3，调度器写互斥已保证安全。
- Project Knowledge/RAG —— 明确低优先级，不引入 Vector DB。
- LangChain/LangGraph 等第二套运行时 —— 禁止，未引入。

## Gap Analysis → 本轮实施

1. **DoneWhen 验证闭环**（最高优先）：条件分类（command/manual）→ 计划完成后逐条在工作区真实执行命令 → 任一命令失败则 Goal failed（步骤全完成也不算数）→ 结果持久化到 brief（doneWhenResults）+ `goal.verification.passed/failed` 事件 → TaskWorkbench 横幅显示真实 ✓/✗/需人工确认。
2. **Goal 预算护栏**：`goalBudgetExceeded`（默认 24 节点执行 / 30 分钟）→ 超限 blocked + `run.blocked` 事件，绝不静默续跑。
3. **安全测试固化**：子代理权限天花板（继承父 permissionContext、只读节点工具集中无写工具）。

## Target Architecture 映射

用户链路（需求一）逐环落位：Task Intake✅ → 澄清✅ → Goal(doneWhen 实证)✅ → Plan DAG✅ → 依赖/并行(调度器)✅ → Agent/Sub Agents✅ → Supervisor(编排)✅ → Trace✅ → Verification(节点级+最终 doneWhen)✅ → Done When 决定完成✅。

## State Ownership / Storage / Recovery

不变：plan/snapshot/brief/events 走结构化存储与既有恢复；本轮新增 doneWhenResults 持久化于 TaskBrief（schema 已补），崩溃后随快照恢复；预算 blocked 相位复用现有 blocked 处置。

## Permission Model（不变式）

Mode(Plan 只读) × Permission(ask/workspace/full) × Role(Primary/SubAgent/Supervisor) 三轴正交；子代理权限 ≤ 父（scopedRuntime 继承 permissionContext + toolsForNode 收窄）；并行层写互斥；Supervisor 无审批旁路（审批仍走 PendingToolApproval）。

## Testing

新增：done-when 解析/评估（含否定式跳过、无工作区跳过、崩溃→failed、manual 不阻塞）、goalBudgetExceeded 边界、编排集成（doneWhen 通过→completed / 失败→failed + 事件）、子代理天花板安全测试。回归见 docs/archive/ADVANCED_AGENT_REGRESSION_REPORT.md。

## Benchmark

Single vs Multi-Agent 数值对比需要真实 Provider 长任务（fixture 无法模拟真实 token/延迟差异），本轮**不做伪造数字**：设计上 subagent 节点由 planner 仅在大上下文独立子任务时生成（小任务单 Agent），多 Agent 是按需而非默认。见 docs/archive/ADVANCED_AGENT_BENCHMARK_REPORT.md（诚实 NOT RUN）。

---

## 2026-11-27 · Computer Use（CUA）v1 落地 + 能力面复核

> 事实来源：本次提交的代码与测试（非文档声明）。BUA（浏览器自动化）此前已完整存在，本轮补的是桌面级 CUA。

### 复核结论：已经完整存在（本轮不改）

| 能力             | 真实实现                                                                                                                                                                                                                       | 证据                                                                                                  |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| BUA 浏览器自动化 | `browser_*` 工具族（open/navigate/back/forward/reload/snapshot/screenshot/click/fill/select/press/scroll/get_text/get_url/tabs/switch_tab/…），Rust CDP 运行时 + AX 快照 `@eN role "name"` 引用语言；loopback 导航 L1、公网 L3 | `src/core/tools/builtin/browser-tools.ts`、`src-tauri/src/browser_commands.rs`、`ax_snapshot.rs`      |
| 审批             | L2+ 审批门（ToolExecutor 对 run profile 校验）、PendingToolApproval 卡片、ask/workspace/full 三档；子代理权限 ≤ 父，Supervisor 无审批旁路                                                                                      | `src/core/tools/tool-executor.ts`、`src/core/security/permission-profiles.ts`                         |
| 监控             | 运行轨迹（run trace）、用量统计、分类结构化本地日志（默认脱敏）、诊断包导出；无远程读取后门                                                                                                                                    | `src/features/tracing`、`src/features/usage`、`src/core/logging`、`src/runtime/diagnostics-export.ts` |
| 同构内核         | web / desktop / VS Code / CLI 共用同一套 `src/core` + `src/runtime`，能力按 target 分层（web 仅 chat+attachments）                                                                                                             | `src/runtime/create-runtime.ts`                                                                       |

### 本轮新增：Computer Use（opt-in，macOS v1）

- 5 个工具：`computer_screenshot`、`computer_frontmost_app`（L1 只读）；`computer_click`、`computer_type`、`computer_key`（L3，必走审批对话——合成输入在任何沙箱之外）。
- 组件 `evir.tools.computer-use` **默认关闭**，只有宿主传入启用的组件配置才注册工具；同时依赖 `computerUse` 能力（仅 desktop runtime 声明）。**已知缺口**：应用目前无参调用 `createRuntime()`，仓库里没有组件开关 UI，所以今天只能在代码层启用；补一个组件开关设置面是后续待办（也同时解锁 backgroundTasks）。
- Rust 侧 `src-tauri/src/computer_use.rs`：截图复用系统 `screencapture`，输入复用 `osascript` + System Events —— **零新增原生依赖**；Windows/Linux 返回明确的「本平台暂不支持」，不假装成功。
- OS 权限仍是硬门：截图需「屏幕录制」，合成输入需「辅助功能」，缺失时如实报错。
- 安全边界：输入文本以 argv 传入，绝不拼进 AppleScript 源码（防注入）；屏幕内容视为不可信外部输入，不授予权限、不回显。

### 明确未做（待后续轮次，不凑数）

- 区域截图 / 多屏选择（v1 只截全屏）。
- 滚轮、拖拽、右键、双击等输入原语。
- Windows / Linux 实现。
- CUA 的 Golden Agent Eval 场景：目前只有单元测试 + 组件装配测试，真机端到端 NOT RUN。
