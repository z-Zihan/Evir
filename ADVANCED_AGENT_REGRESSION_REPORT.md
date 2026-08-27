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

- Goal doneWhen 验证、预算阻断、子代理天花板在**原生 Tauri 实机 + 真实 Provider** 下的端到端（本轮为单测/集成 + 浏览器 desktop-mode e2e；fixture provider 无法产生真实命令执行差异——fixture 工作区的命令由 mocked storage 验证）。
- `pnpm test:visual`：本轮 UI 仅 goal 横幅条件行内样式微调，fixtures 无 doneWhen 场景，基线不受影响，未重跑（上轮全绿）。
