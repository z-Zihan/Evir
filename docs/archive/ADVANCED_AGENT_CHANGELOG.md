> **Status: Archived（历史执行产物）**
> 本文件是某一次工作轮的一次性执行/测试/审计记录，仅作历史证据，不代表当前产品状态，也不是规范来源。
> 当前事实来源：根目录 `AGENTS.md`、`docs/agent/Evir-project-memory.md` 与 `docs/` 正式文档。

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

## 追加（同日第二批）

- **Token 精确预算**：`goalBudgetExceeded` 增加 `maxTokens`（默认 2M），编排每批次间从 usage_records 汇总本会话自 run 开始以来的 provider/估算 token，超限 → blocked（读取失败时安全跳过，绝不因预算检查中断执行）。
- **偏好记忆候选**：任务完成（completed）且 brief 含约束时，TaskWorkbench 展示候选卡片：列出约束 + [全局记住]/[记住到本项目]/[忽略]；**任何保存都必须用户显式点击**，保存为 long-term 记忆（global 或项目根 scope，confidence 0.6）；无项目时项目按钮禁用；已含 3 个组件测试（不自动保存/双 scope/忽略）。
- **Goal 模式管线修复**：stream-response 的循环入口/编排分支/审批分支/run 记录此前只认 agent，Goal 会掉入 ask 分支——已全部路由（agent-loop 内部 goal→agent 工具档翻译不变）。
- **验收补齐**：`cargo fmt --check` 与 `cargo clippy -D warnings` 实际执行并通过。

## Not Done（按优先级明确不做）

- RAG（不引入 Vector DB）、LangChain/LangGraph（禁止且未引入）。

## 追加（同日第三批：③④⑤⑥ 高级能力 + 真实 Provider 实测闭环）

- **Goal Usage 条**（③）：TaskWorkbench "目标资源消耗"展示耗时 / Agent 运行次数 / 工具调用次数（事件派生）+ finished 后从 usage_records 汇总本次 run 的真实 token（标注"估算值——优先采用 Provider 上报"）。
- **运行中动态 Re-plan**（④）：scheduler.run 失败后自动重置 failed→ready、revision+1、`plan.revised` 事件并持久化，一次重试上限（MAX_REPLAN_NODE_EXECUTIONS=18）。
- **Git Worktree 并行写**（⑤）：Rust `git_worktree_create/merge/remove`（merge = add -A + diff --binary + 主树 apply --3way，冲突显式失败）；PlanNode.isolation="worktree" 时调度器不视为资源冲突（`resourcesConflict` 放行双方 worktree），子代理在 worktree 内执行后合并回主树再清理。
- **项目知识检索 search_docs**（⑥）：L1 只读工具，DOC_EXTENSIONS(.md/.mdx/.txt/.rst/.adoc) 逐行匹配，file:line:内容 最多 80 条；无 Vector DB。
- **真实验证暴露并修复的 4 个缺陷**（原生 app + EvoMap GLM glm-5.2 真实链路，三轮 Goal 任务）：
  1. Goal 模式确认工作台不渲染（ChatView 只在 agent 模式挂 TaskWorkbench）——补 goal gate。
  2. `parseDoneWhen` 只认独占行 "Done when:"，用户自然的同行写法解析不出——支持行内标记（中英文冒号、分号多条件），DoneWhen 闭环因此从未启动过的缺陷随之修复。
  3. verification 节点被双层工具策略拦死 run_command（toolsForNode 按 riskLevel 白名单只放行 L0/L1 + executeLoop 无写作用域即 mode=plan 再滤一次）→ "Verification produced no successful tool evidence" 历史上 7 个 run 同因失败——verification 节点放行 run_command（capability 过滤仍生效）且节点循环用 agent 工具档（边界仍在 toolsForNode 白名单 + 执行期审批）。
  4. GLM 偶发把参数序列化拼进 tool call name（如 `run_commandprogram</arg_key><arg_value>ls</arg_value>`）被当作未知工具拦截——`normalizeToolCallName` 最长前缀匹配已知工具 id 恢复 + `agent.tool-name-normalized` 事件。
- **实测结论**（run 950d9cf3 全绿）：plan.confirmed → create-file（write_file 6 字节）→ verify-file 真实执行 `ls`（退出码 0，verification.completed）→ `goal.verification.passed` → `run.completed`；磁盘 `/tmp/evir-real-verify/hello3.txt` 内容 "three"；7 个 provider 请求共 13273 tokens 真实计费入库；模型口头 PASS 而无工具证据时系统正确判失败（"模型文本不算完成"防线实测有效）；完成态呈现偏好记忆候选卡（全局记住/记住到本项目/忽略）。
