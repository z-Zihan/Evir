# Evir Project Memory — 当前事实索引

> Scope: 仅适用于 Evir 仓库。本文件是**高密度当前事实索引**，不创建新事实，不承载历史，不复制规范内容。
> 出现疑问或冲突时，一律继续读下方指向的权威文档。
> Last reviewed: 2026-09-04（Desktop Agent Focus & Core Simplification 轮）

## 权威文档路由（唯一事实源）

| 主题         | 权威文档                                  |
| ------------ | ----------------------------------------- |
| 产品逻辑     | `docs/01-product-requirements.md`         |
| 架构与分层   | `docs/02-technical-architecture.md`       |
| 设计规范     | `docs/04-design-specification.md`         |
| 工程标准     | `docs/05-engineering-standards.md`        |
| Agent 安全   | `docs/07-agent-security-and-quality.md`   |
| 逐项验证状态 | `docs/release-readiness.md`（含 NOT RUN/BLOCKED 清单） |
| 性能实测     | `docs/benchmarks/latest.json`             |
| Agent Eval   | `eval/README.md`                          |
| 发布门禁     | 根目录 `AGENTS.md`                        |
| 历史材料     | `docs/archive/`（含原 06 开发计划、12/18 评审、reviews 快照，均带 Historical 标记） |

## 当前产品心智（细节以 docs/01 为准）

- **主产品 = Desktop Project Agent**（工作台式项目线程：任务流 + Context Workbench + 可驾驶 Composer）。Web = Maintenance 聊天；VSIX / CLI = Preview；Plugin / Multi-user / Canvas / Ego Lite = Experimental（冻结扩张）。
- Standalone Chat 恒为 Ask；Project 内默认 Task（模型自行决定是否用工具），Plan/Goal 经 `/plan`、`/goal` 触达。
- 权限三档 per-project，首开由用户显式选择（workspace 推荐 / ask 谨慎；full 保持高风险确认）。

## 关键路径（改动前先读对应模块）

- 主控制流：`src/features/chat/stream-response.ts`（turn 编排）→ `turn/`（prepare/verify/persist）→ `agent-loop.ts` + `agent-loop-phases.ts`（执行）→ `orchestration/run-orchestrated-agent.ts` + `orchestrated-run-state.ts` + `orchestrated-node-execution.ts`（编排）。
- Run 状态机唯一事实源：`src/features/chat/run-phase.ts`（派生优先级与真相映射）；`StreamSlot.phase` 含 verifying。
- 权限判定：`src/core/tools/tool-executor.ts`（L2+ 边界；相对路径先解析到 workspace root 再判）。
- Skill 分层：manifest `tier: core|general`；核心 15 个（`skills/builtin/*/manifest.json` 标记）。
- Provider 分级：`ProviderPreset.agentTier`（agent-verified=GLM / protocol-verified=5 家 / preset=其余）。
- Agent Eval：`eval/agent-eval/`（`pnpm test:agent-eval`；结果 `eval/results/latest.json`）。

## 当前测试基线指针

数字不在此复制（会漂移）：TS/Rust/E2E 计数与通过状态见 `docs/release-readiness.md`；体积见 `docs/benchmarks/latest.json`；Agent Eval 见 `eval/results/latest.json`。

## 当前已知约束（细节以权威文档为准）

- LICENSE 未定（BLOCKED，须项目负责人决定）；Windows 全量验收 NOT RUN；30–60 分钟长任务 NOT RUN。
- 测试不得消耗真实 Provider 配额（fixture 服务器或标 NOT RUN）；模型文字不能标记任务完成（mutating run 需证据；answer run 见 docs/01）。
- 永不记录密钥/完整会话/文件正文；日志本地、脱敏、有界。
