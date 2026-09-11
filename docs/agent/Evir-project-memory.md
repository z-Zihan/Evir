# Evir Project Memory — 当前事实索引

> Scope: 仅适用于 Evir 仓库。本文件是**高密度当前事实索引**，不创建新事实，不承载历史，不复制规范内容。
> 出现疑问或冲突时，一律继续读下方指向的权威文档。
> Last reviewed: 2026-09-04（Desktop Agent Focus & Core Simplification 轮）

## 权威文档路由（唯一事实源）

| 主题         | 权威文档                                                                            |
| ------------ | ----------------------------------------------------------------------------------- |
| 产品逻辑     | `docs/01-product-requirements.md`                                                   |
| 架构与分层   | `docs/02-technical-architecture.md`                                                 |
| 设计规范     | `docs/04-design-specification.md`                                                   |
| 工程标准     | `docs/05-engineering-standards.md`                                                  |
| Agent 安全   | `docs/07-agent-security-and-quality.md`                                             |
| 逐项验证状态 | `docs/release-readiness.md`（含 NOT RUN/BLOCKED 清单）                              |
| 性能实测     | `docs/benchmarks/latest.json`                                                       |
| Agent Eval   | `eval/README.md`                                                                    |
| 发布门禁     | 根目录 `AGENTS.md`                                                                  |
| 历史材料     | `docs/archive/`（含原 06 开发计划、12/18 评审、reviews 快照，均带 Historical 标记） |

## 当前产品心智（细节以 docs/01 为准）

- **主产品 = Desktop Project Agent**（工作台式项目线程：任务流 + Context Workbench + 可驾驶 Composer）。Web = Supported 聊天；VSIX / CLI = Preview（持续演进）；Plugin / Multi-user / Canvas / Ego Lite = Extended（已交付、保留维护；优先级管理而非冻结，新增复杂度不得退化核心 Agent 质量/Runtime/性能预算/Golden Eval）。
- Standalone Chat 恒为 Ask；Project 内默认 Task（模型自行决定是否用工具），Plan/Goal 经 `/plan`、`/goal` 触达。
- 权限三档 per-project，首开由用户显式选择（workspace 推荐 / ask 谨慎；full 保持高风险确认）。

## 关键路径（改动前先读对应模块）

- 主控制流：`src/features/chat/stream-response.ts`（turn 编排）→ `turn/`（prepare/verify/persist）→ `agent-loop.ts` + `agent-loop-phases.ts`（执行）→ `orchestration/run-orchestrated-agent.ts` + `orchestrated-run-state.ts` + `orchestrated-node-execution.ts`（编排）。
- Run 状态机唯一事实源：`src/features/chat/run-phase.ts`（派生优先级与真相映射）；`StreamSlot.phase` 含 verifying。
- 权限判定：`src/core/tools/tool-executor.ts`（L2+ 边界；相对路径先解析到 workspace root 再判）。
- Skill 分层：manifest `tier: core|general`；核心 15 个（`skills/builtin/*/manifest.json` 标记）。
- Provider 分级：**模型级证据驱动**——`provider-tiers.ts` 的 `effectiveModelAgentTier`（providerId+modelId+endpointClass 匹配，解析时按连接端点过滤，跨模型/跨端点不借证据）；每次真实 run（pass/fail/partial）都进 `provider-validation.json` 历史，**最新一次真实 run 决定档位**。2026-09-11 门槛复审：Verified 档（agent-verified 20 任务 / smoke-verified 10 任务）要求 ≥90% 且 0 越权/0 越界；≥80% 且 0/0 但 <90% = **eval-candidate**。当前唯一实测模型：zhipu preset 经 EvoMap 网关 `evomap-deepseek-v4-flash` 2026-09-09 全量 16/20 → **Eval Candidate**（尚无 Agent Verified 持有者；历史含同日 partial，不掩盖；不代表 GLM 系模型）。README/Settings/docs 由 `scripts/check-doc-facts.mjs` 门禁统一（含长任务措辞规则）。
- Agent Eval：`eval/agent-eval/`（`pnpm test:agent-eval`；结果 `eval/results/latest.json`）。真实长任务中断+续跑：`eval/long-task/`（env 门控 `EVIR_LONG_TASK=1`）。
- 编排节点工具边界：`toolsForNode`（orchestrated-run-state.ts）——验证节点的 run_command 放行不依赖 plan 声明 terminal capability（2026-09-09 修复的死分支，有回归用例）。

## 当前测试基线指针

数字不在此复制（会漂移）：TS/Rust/E2E 计数与通过状态见 `docs/release-readiness.md`；体积见 `docs/benchmarks/latest.json`；Agent Eval 见 `eval/results/latest.json`。

## 当前已知约束（细节以权威文档为准）

- LICENSE 未定（BLOCKED，须项目负责人决定）；Windows 全量验收 NOT RUN（TS 层有 deterministic Windows 路径测试，真机未跑）；单次连续 ≥30 分钟长任务 PASS 样本未取得（无头最佳 24.7min；GUI 4 次续跑交付物已独立复核全绿，见 release-readiness 长任务行）。GUI 子进程 PATH 无 pnpm 已于 2026-09-09 修复（Rust `command_env.rs`：login+interactive rc 双探测、白名单、OnceLock 缓存；run_command/dev_server 注入；cwd 的 node_modules/.bin 前置；诊断面板 Command Environment 实测 node/npm/npx/git/python3/cargo/rustc 全部可见）。已知平台问题：release 构建下 macOS 26.5 的 Tauri custom-scheme IPC 间歇 ~100s stall（desktop.ipc.timeout/retry，tauri#7662），曾阻塞安装版 App Preview 脚本检测（同代码 dev 实例正常）；App Preview 检测 IO 失败与真无脚本共用 noScript 文案是待改进项。单次连续 ≥30min 长任务 PASS 仍未取得（2026-09-09 深夜再补 3 个无头样本全 FAIL：断言面已修、模型多阶段驱动力不足+流错误；见 release-readiness 长任务行与桌面 Evidence）。
- 测试不得消耗真实 Provider 配额（fixture 服务器或标 NOT RUN）；模型文字不能标记任务完成（mutating run 需证据；answer run 见 docs/01）。
- 永不记录密钥/完整会话/文件正文；日志本地、脱敏、有界。
