> **Status: Archived（历史执行产物）**
> 本文件是某一次工作轮的一次性执行/测试/审计记录，仅作历史证据，不代表当前产品状态，也不是规范来源。
> 当前事实来源：根目录 `AGENTS.md`、`docs/agent/Evir-project-memory.md` 与 `docs/` 正式文档。

# 高级 Agent 能力 — Single vs Multi-Agent 基准报告

## 结论（诚实声明）

本轮**未执行**数值化 Single vs Multi-Agent 基准：真实对比需要付费 Provider 上的长任务样本（token/延迟/完成率差异无法由本地 fixture 模拟），伪造数字违背产品原则。

## 设计层面的既有多 Agent 价值保障

按需求 六十九/七十一 的原则，Evir 的多 Agent 不是默认路径：

1. **按需生成**：subagent 节点由 `ModelPlanGenerator` 仅在子任务相互独立、上下文较大时规划；小任务（如“改一个按钮”）生成单链 task 计划（现有编排测试可见两类计划并存）。
2. **成本上限**：worker 有 `{maxTurns:12}`；本轮新增 Goal 级预算（24 节点/30 分钟 → blocked）。
3. **隔离收益可测**：worker 上下文=目标+依赖摘要（nodeMessages），非父会话全量——上下文隔离是结构性收益，不依赖基准证明。
4. **调度安全**：read+read 并行、写互斥——并行不会引入冲突成本。

## 下一阶段建议

接入真实 Provider 后建立基准脚本：同一任务集（含可并行分析类 / 纯执行类）跑 single 与 planner 生成的 subagent 计划，度量完成率、总 token、延迟、验证通过率；若某类任务 single 更稳，则收紧 planner 的 subagent 生成阈值。
