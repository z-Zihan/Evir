> **Status: Archived（历史执行产物）**
> 本文件是某一次工作轮的一次性执行/测试/审计记录，仅作历史证据，不代表当前产品状态，也不是规范来源。
> 当前事实来源：根目录 `AGENTS.md`、`docs/agent/Evir-project-memory.md` 与 `docs/` 正式文档。

# 高级 Agent 能力升级 — 回归报告

> 2026-08-27 · 全部命令在仓库根目录实际执行。

| 门禁                                                 | 结果                                                 |
| ---------------------------------------------------- | ---------------------------------------------------- |
| `pnpm format:check` / `pnpm lint` / `pnpm typecheck` | ✅ 全过                                              |
| `pnpm test`                                          | ✅ 99 文件 / **613 通过** / 0 失败（基线 600 → +13） |
| `pnpm test:e2e`（web+desktop）                       | ✅ 35 通过 / 9 平台跳过                              |
| `pnpm test:a11y`                                     | ✅ 18/18                                             |
| Rust / 构建 / benchmark / CLI / VSCode               | 本轮未触及（纯 TS 编排层改动；上轮全绿基线仍有效）   |

## 新增测试

- done-when（8）：命令/手工分类（中英文 PASS/通过 标记、引号命令）、真实退出码判定（模型声称不算数）、manual 不阻塞、否定式与无工作区跳过（跳过≠通过）、命令崩溃→failed、doneWhenSatisfied 全量通过语义、splitCommand。
- goal-budget（2）：默认限内通过；节点数/时长超限给出可行动原因；自定义 limits 边界。
- 编排集成（+2）：doneWhen 全过→plan completed + `goal.verification.passed`；命令失败→plan failed + `goal.verification.failed`（即使所有步骤 completed）。
- 子代理安全（+1）：worker 继承父 permissionContext（无提权）、只读节点工具集无 write_file。

## NOT RUN（如实声明）

- **Goal→DoneWhen 完整链路 e2e**：尝试了两版（真实发送 + 确认点击；种子快照）。真实发送版本因 fixture 规划的非确定性（是否需要确认、审批节奏）不稳定；种子快照版本暴露了快照重建对 seeded 数据的校验路径问题未及在本轮修复。DoneWhen 的执行语义、失败判定、持久化与 UI 状态由 17 个单测/集成测试覆盖；该 e2e 列入下阶段。

- Goal doneWhen 验证、预算阻断、子代理天花板、偏好候选在**原生 Tauri 实机 + 真实 Provider** 下的端到端（本轮为单测/集成 + 浏览器 desktop-mode e2e；fixture provider 无法产生真实命令执行差异——fixture 工作区的命令由 mocked storage 验证）。
- `pnpm test:visual`：本轮 UI 仅 goal 横幅条件行内样式微调，fixtures 无 doneWhen 场景，基线不受影响，未重跑（上轮全绿）。

## 追加（同日第三批回归：③④⑤⑥ + 真实 Provider 实测修复）

| 门禁                                                 | 结果                                |
| ---------------------------------------------------- | ----------------------------------- |
| `pnpm format:check` / `pnpm lint` / `pnpm typecheck` | ✅ 全过                             |
| `pnpm test`（第三批后）                              | ✅ 101 文件 / **632 通过** / 0 失败 |
| `cargo fmt --check` / `cargo clippy -D warnings`     | ✅（worktree 三命令批次）           |

- 新增测试：worktree 调度（3：无隔离冲突 / worktree 隔离不冲突 / 隔离写并行 maxInFlight=2）；parseDoneWhen（7：独占行 / 行内中英文 / 分号多条件 / 上限）；verification 工具边界（1：verify 节点 agent 档 + run_command 放行、只读节点保持 plan 档 + L0/L1）；normalizeToolCallName（4：合法名 / 参数碎屑恢复 / 未知名 / 最长前缀）。
- **NOT RUN → 已实测**：上一批声明的"原生 Tauri 实机 + 真实 Provider 端到端"缺口已由真实会话补上（EvoMap GLM glm-5.2，三轮 Goal 任务、SQLite/磁盘/结构化日志三源取证），其中暴露的 4 个真实缺陷（goal 工作台 gate / DoneWhen 同行解析 / verification 节点 run_command 双层拦截 / 畸形 tool-call name）已修复且回归全绿。Goal→DoneWhen 的 Playwright e2e 仍列 NOT RUN（语义已由单测 + 真机覆盖）。
