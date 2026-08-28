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
