# 高级 Agent 能力升级 — 变更记录

> 2026-08-27 · 基线 5b7fbbe。审计结论见 `docs/advanced-agent-capabilities-plan.md`：Task Intake / 动态澄清 / Plan DAG / 只读并行 / Sub Agent / Supervisor / Trace / 节点级 Verification / Recovery 在代码中已完整存在，本轮只补真实缺口，未引入第二套运行时。

## Added

- **DoneWhen 验证闭环**（`core/orchestration/done-when.ts`）：
  - 条件分类：含可执行命令（pnpm/node/cargo/pytest/make/git/test/check/build/lint/e2e…）且非否定式（“失败/FAIL/exit 1”）→ `command`；评审标准等 → `manual`。
  - 计划节点全部完成后**逐条在工作区真实执行**命令（120s 超时，引号参数拆分）：任一 command 条件失败 → Goal `failed`（步骤全完成也不算数）；manual 条件展示“需要你确认”且不阻塞；无工作区/否定式 → `skipped`（不计为通过）。
  - 结果持久化到 TaskBrief（`doneWhenResults`，修复了 doneWhen 不在 zod schema 导致重载丢失的 bug）+ `goal.verification.passed/failed` 事件；TaskWorkbench 目标横幅显示真实 ✓/✗/需确认与失败证据。
- **Goal 预算护栏**（`core/orchestration/goal-budget.ts`）：默认 24 次节点执行 / 30 分钟墙钟，超限 → run `blocked` + `run.blocked` 事件 + 阻断原因，绝不静默续跑。

## Enhanced

- `runEventSchema`/`RunEventType` 新增 `run.blocked`、`goal.verification.passed/failed`。
- TaskBrief schema：`doneWhen`（修复持久化剥离）、`doneWhenResults`。
- 安全测试固化：子代理继承父 permissionContext（无提权）且只读节点工具集不含写工具；并行写互斥由既有 `scopesConflict` 保证（同 workspace/git 写冲突、read+read 不冲突）。

## Not Done（按优先级明确不做）

- 偏好记忆候选 UI（Phase 4）、并行写/Git Worktree（Phase 3，写互斥已安全）、RAG（不引入 Vector DB）、LangChain/LangGraph（禁止且未引入）。
