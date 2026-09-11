# Evir Release Readiness — 当前验证状态

> 本文档是**当前版本验证程度的唯一来源**。状态只允许基于实际代码、测试、运行记录、CI 与真机验证填写。
> 基线：2026-09-02（Full Product Regression & UX Recovery；基线 commit `9dc580e8fd7e4c18cb36ed4c412f1dac8d14f850`，验证包含待提交修复）。上一轮记录：`docs/archive/`。
> 状态语义：`PASS`（有当期证据）· `PARTIAL`（部分证据/部分场景）· `NOT RUN`（未执行）· `BLOCKED`（被外部条件阻塞）· `FAIL`。

## 构建与静态质量

| 项                               | 状态 | 证据                                                        |
| -------------------------------- | ---- | ----------------------------------------------------------- |
| Format / Lint / strict Typecheck | PASS | `pnpm check`（2026-09-02）                                  |
| TypeScript Unit + Integration    | PASS | vitest 131 files / 867 tests（2026-09-02）                  |
| VS Code 扩展测试                 | PASS | 8/8（2026-09-02）                                           |
| CLI 测试                         | PASS | 8/8（2026-09-02）                                           |
| Rust 测试                        | PASS | 66 passed / 1 live-CDP ignored（2026-09-02）                |
| Web 构建                         | PASS | `pnpm build:web` / `pnpm benchmark`（2026-09-01）           |
| Desktop 前端构建                 | PASS | `pnpm build:desktop:frontend` / benchmark（2026-09-01）     |
| 日常 CI（PR/main）               | PASS | quality.yml + windows-sanity（Rust check + frontend build） |

## E2E 与矩阵（fixture，零配额）

| 项                        | 状态 | 证据                                                                                                                                                                  |
| ------------------------- | ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Core E2E（web+desktop）   | PASS | 40 passed / 10 capability skips（2026-09-02）                                                                                                                         |
| UI 矩阵 / 视觉基线 / a11y | PASS | UI 2/2；visual 6/6；a11y 18/18（2026-09-02）                                                                                                                          |
| 压力与边界（fixture）     | PASS | 7 passed / 1 web capability skip；含既有 1003 会话 / 500 消息 / 102K prompt / 102 项目覆盖                                                                            |
| Benchmark 预算            | PASS | Web initial gzip 325.57 KiB；Desktop frontend 15057.19 KiB；Desktop initial gzip 337.51 KiB；当前 arm64 DMG 达标。旧 x64/secondary 产物使聚合状态为 `stale-artifacts` |

## 原生 Desktop

| 项                             | 状态    | 证明                                                                                                                                                                                                                                                                          |
| ------------------------------ | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| macOS arm64：构建 + DMG        | PASS    | 0.1.0 arm64；当前 DMG SHA256 `e65cf3c1234ca1c4cdaa1be520b8f853f06104b29e7c0dc3bd7e79d8c3becd45`；`/Applications/Evir.app` 与构建产物主二进制 SHA256 `eb1e9644b259cac99902737a9b10f6afbf54076e7a47c452e51c4443221adee1` 一致，深度签名校验与启动 smoke test 通过（2026-09-02） |
| macOS arm64：实机核心旅程      | PASS    | 覆盖安装、Provider fixture、Chat、项目任务、Plan/Goal、审批、Files/Changes/Outputs/Preview/Browser、Skills/MCP、崩溃恢复均在安装版复测（2026-09-01）                                                                                                                          |
| macOS arm64：性能              | PASS    | 冷启动 0.27–1.22s（均值 0.70s）、空闲 RSS 75.6MB / CPU 0.0%（2026-08-31）                                                                                                                                                                                                     |
| macOS x64：构建                | PASS    | x64 DMG 可产出（2026-08-26 本地）                                                                                                                                                                                                                                             |
| macOS x64：实机安装            | NOT RUN | 无 Intel 实机证据                                                                                                                                                                                                                                                             |
| Windows：全部                  | BLOCKED | 无真机。windows-sanity CI job 保留（Rust check + frontend build）                                                                                                                                                                                                             |
| 正式签名 / 公证                | BLOCKED | 当前为有效 ad-hoc 签名；Gatekeeper 拒绝。缺 Developer ID 与 notarization 凭据，不能声称正式分发签名通过                                                                                                                                                                       |
| 升级 / 降级 / 迁移             | PASS    | DMG 覆盖升级 ×5+：每次 SHA256 一致、59 会话 / 43 runs / 578 消息全量留存、vault 完好                                                                                                                                                                                          |
| Crash Recovery（真实崩溃场景） | PASS    | 既有 5/5 场景保持；2026-09-01 再次对安装版注入隔离 checkpoint 后裸 `kill -9`，恢复提示出现，且新 session 工具事件 0 条（未自动重放）；清理 checkpoint 后 SIGTERM/reopen 提示消失                                                                                              |

## 真实 Provider 与长任务

| 项                                                                                                 | 状态                                                                               | 证明                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Real EvoMap 网关（zhipu preset · openai-compatible · `evomap-deepseek-v4-flash`，DeepSeek 系模型） | PASS                                                                               | 真实 Ask/流式/停止/恢复/错误分类/审批/写盘（2026-08-27/28/29 多轮，当时误记为"GLM"）；2026-09-09 全量 20 任务 required suite 16/20（0.8）、toolCallSuccess 0.891、0 越权、0 越界 → 模型级 Agent Verified；历史含同日 17/20+2 越界的 partial 记录（见 provider-validation.json）                                                                                                                                                                                                                             |
| Real Agent 多工具任务（真实 Provider）                                                             | PASS                                                                               | BugFix 147 次工具执行 3 尝试后完成+独立核验 132 全绿；Refactor shared.js 提取 134 全绿                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 其他协议真机（Anthropic/Gemini/OpenAI 原生等）                                                     | NOT RUN                                                                            | 适配器有测试，未真机取证                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 回滚（原生点击）                                                                                   | PARTIAL                                                                            | 磁盘级验证 3/3（修改恢复/新建删除/删重命名恢复）通过；安装版回滚入口与确认框已打开并取消。最终确认会删除/恢复本地文件，自动化策略要求用户明确确认，故未点击                                                                                                                                                                                                                                                                                                                                                 |
| 30 分钟 Agent 任务                                                                                 | PARTIAL                                                                            | BugFix ✅ 独立核验通过；Refactor ✅（跟进后完成）；Feature ⚠️ 验证器诚实判 FAILED（修复后待重跑）                                                                                                                                                                                                                                                                                                                                                                                                           |
| 60 分钟 Agent 任务                                                                                 | PARTIAL                                                                            | #1（test-docs-site，2026-08-31）真模型全链路 2h：5 文件真实写盘（含 README-BUGFIX.md 缺陷报告+校验工具链），逐次审批/退出码/诚实终态全部按设计；终态 needs_verification（auto-verification `pnpm check` 在纯文档项目不适用）。有效样本 0→1，第二样本待补                                                                                                                                                                                                                                                    |
| 20–50 轮长对话（真实需求变更）                                                                     | PASS                                                                               | 20 轮 + 30 轮（含需求变化）各 100% 完成，上下文保持（2026-08-31）                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 超长工具输出 / Context 压缩实机                                                                    | PARTIAL                                                                            | 压缩层级单测过；原生长输出场景未取证                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 30–60min 长任务中断+续跑（2026-09-09 本轮）                                                        | PASS(无头 run1/2 + GUI 交付物复核) / FAIL(其余全部样本，均如实拒绝；本轮再+3 FAIL) | 无头四样本（eval/long-task，真实端点）：run1 PASS 24.7min；run2 PASS 18.2min；run3/4 FAIL 被拒。2026-09-09 深夜补 3 样本全部如实 FAIL：①task-large 21min 完成但断言面过窄误判（模型把 --json 放进新建 src/doctor.ts，断言已改为扫 src/ 全目录）且时长不足 30min；②③task-xl 模型在阶段1 后自然停 + 续跑遇 provider 流错误；resume prompt 已强化连续执行。**单次连续 ≥30min PASS 仍未取得（如实）**；样本日志在桌面 Evidence 目录。GUI 子进程 PATH 无 pnpm 本轮已修复（command_env.rs login-shell 解析+注入） |
| MCP：设置与本地 stdio Runtime                                                                      | PASS                                                                               | 连接测试发现 1 tool；enable→Ready；restart→新 PID 且 Ready；disable 后恢复原状态（2026-09-01）                                                                                                                                                                                                                                                                                                                                                                                                              |
| MCP：Agent 会话内审批取证                                                                          | NOT RUN                                                                            | 仅完成 Runtime 与设置页链路；不可冒充 Agent 会话工具调用                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| MCP：HTTP / 外部真实 Server / Windows                                                              | PARTIAL                                                                            | 不可用 HTTP fixture 得到明确 `Load failed`；外部真实 Server 与 Windows 未验证                                                                                                                                                                                                                                                                                                                                                                                                                               |

## UI / UX Final Redesign（2026-08-31 至 2026-09-01）

| 项                         | 状态 | 证明                                                                                       |
| -------------------------- | ---- | ------------------------------------------------------------------------------------------ |
| CSS Tooltip 系统           | PASS | 替换 52 处原生 title；方向翻转 + max-content + 双主题验证；axe 0 violation                 |
| a11y 可访问名              | PASS | tooltip 运行时镜像 data-tip→aria-label（button-name 95→0）；模型切换器 aria-label          |
| 侧栏拖拽调宽               | PASS | 200–420px 拖拽 + 持久化 + 双击重置；5 单测；显式格位防 auto-placement 回归                 |
| 侧栏横向溢出               | PASS | projects / conversations 区 overflow-x: hidden                                             |
| 行操作按钮浮层             | PASS | 不透明背景 + 边框 + 阴影，不再透出底层文字                                                 |
| 连点防护                   | PASS | 4 个提交入口同步抢占 phase，杜绝并行管线（连点 12 次只执行 1 次）                          |
| 视觉基线更新               | PASS | 3 个 web 项目 --update-snapshots + 人工逐张复核                                            |
| Web/Desktop 能力边界       | PASS | Web 隐藏 Desktop Workspace 与 Desktop-only Settings，避免展示不可用入口；安装版复测        |
| Composer 接受语义          | PASS | 用户消息持久化/接受后立即清空草稿，不等待完整 Agent run；新增竞态回归测试                  |
| Files/Changes/Outputs 路径 | PASS | project-relative tool path 统一解析为安全绝对路径；拒绝 `..` 越界；安装版 Diff/Output 实测 |
| Browser 主窗口子 WebView   | PASS | 生命周期、布局可见性、URL 导航完成与错误事件结构化；安装版记录非零布局及导航完成           |
| 许可状态文案               | PASS | About 不再暗示仓库已有开源许可证；明确 LICENSE 尚未选择                                    |

## Eight Core Capabilities（八大能力，2026-09-08 轮）

| 能力                   | Implementation                                                                                                                                                                            | Automation                                                                                                 | Native Manual                                                           | Real Provider                                                                                  | Known Gaps                                                                                                                                                         |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 长上下文压缩           | 四级预算压缩（0.6 工具输出→0.75 LLM 摘要→0.9 checkpoint）+ 摘要 prompt 覆盖目标/约束/决策/文件/命令/错误/进度/待办/审批状态/模型变更；工具输出截断时全量归档 artifacts 并在截断标记中引用 | 压缩层级/字段/归档/预算单测（context-budget 50+ 用例）                                                     | 安装版 60min 任务历史 PASS；本轮 30–60min 长任务复验见下                | 真实 GLM eval 含大上下文任务（17-volume-context-objective PASS）                               | token 估算 len/4 仍粗估（工具调用参数未计入）；真实长任务压缩触发取证见长任务段                                                                                    |
| 断点续跑与异常恢复     | run 起始即写 checkpoint（任意中途崩溃留痕）+ 启动恢复横幅 + orchestration paused 恢复 + 文件快照回滚；恢复绝不自动重放工具                                                                | crash-recovery / checkpoint / repository / retry-run / approve-paused 单测 + e2e 恢复横幅                  | 既有 kill -9 安装版 PASS（5/5）；本轮 run-start checkpoint 扩大了覆盖面 | 真实 GLM eval 18-tool-failure-recovery PASS                                                    | 恢复横幅尚未展示 checkpoint 明细（查看详情入口）；run 中途 tool 结果仍回合末落盘                                                                                   |
| 配置/能力可插拔        | Component Runtime + manifests + reconcile；Plugin 贡献 slash/skills/settings；MCP 动态组件；capability 双闸（注册期 manifest + 执行期 requiredCapability）                                | builtin-tool-components / create-runtime 组件装配测试（disable terminal → run_command 从 runtime 消失）    | 安装版 MCP enable→Ready→restart→disable 历史 PASS                       | 真实跑经同一 runtime                                                                           | plugin 贡献点仍为 3 类（slash/skills/settings）；UI 级组件配置入口有限                                                                                             |
| Skill 与 Tool 分层治理 | 15 Core + General 两层；Skill 只提供方法（进 system prompt），权限由 Tool Registry/Executor/Profile 决定                                                                                  | skill-permission-separation（声明不授权）+ skill-router/catalog 测试                                       | 设置页 Skill 开关可用                                                   | Skill ON/OFF 真实 A/B（eval/skill-ab，5 核心 Skill）                                           | A/B 为单样本方向性信号                                                                                                                                             |
| 全流程可观测           | Trace 事件 19 类 + 审批多 span 独立计时 + 完整 Response 由消息正文+chunk offset 重建 + 工具行摘要 + knowledge.retrieved + 导出/保留/脱敏                                                  | trace-recorder 18 用例（含双审批隔离、pending、offset 映射）+ trace e2e                                    | 安装版运行详情真人验收见下                                              | 真实 GLM 任务全链路 trace                                                                      | stream.reasoning-delta 仍为预留（当前 provider 不回传 reasoning 到该通道）                                                                                         |
| 安全与权限控制         | 三档 profile + Rust 路径边界（canonicalize/symlink/系统前缀）+ 模式风险上限 + L4 恒审批 + 审批全链路审计                                                                                  | permission-matrix（profile × 操作 × 越界/逃逸/L4）+ infra.rs symlink Rust 测试                             | 安装版审批/权限 onboarding 历史 PASS                                    | 真实 GLM eval unauthorized=0（10 与 20 任务两轮）                                              | scoped approval（本次允许/本工作区允许）未实现——审批仍为逐次                                                                                                       |
| 多场景任务编排         | 无独立 mega-router：Skill Routing + Tool Capability + Mode 复用；验证节点验收命令放行不依赖 plan 作者声明 terminal（2026-09-09 修复 toolsForNode 死分支）                                 | multi-scenario 脚本档 4/4（data/web/document/automation，§51 指标）+ verification 节点缺 terminal 回归用例 | —                                                                       | 真实档各 1 类实跑（见 eval/results/multi-scenario-real）+ 真实长任务中断续跑（eval/long-task） | web 场景用 loopback fixture（真实外网研究属 Browser Provider 范围）；编排验证节点 run_command 曾因 capability 过滤不可达（已修复，GUI 重装后续跑因屏幕锁 PENDING） |
| 可扩展知识库           | Knowledge Base v1 全量（六类源/结构分块/检索溯源/项目绑定/Profile 隔离/权限约束/预算注入/search_knowledge 工具/trace 事件）                                                               | knowledge-core 20 用例 + knowledge-eval 10 金任务 + harness/context 集成测试                               | 安装版 Knowledge 真人验收见下                                           | search_knowledge 于真实任务可用（本轮安装版旅程验证）                                          | Keyword Retriever v1（关键词+CJK bigram，全量内存扫描；非 FTS）；SQLite FTS5 为既定升级路径（阈值见 benchmarks）；向量检索留接口未实现；MCP 资源仅文本型           |

## 日志与证据关联（2026-09-01）

| 项                                    | 状态 | 证明                                                                                                                                               |
| ------------------------------------- | ---- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Correlation IDs                       | PASS | `sessionId/windowId/projectId/threadId/runId/planId/toolCallId/browserSessionId/actionId/evidenceId` 可按链路携带                                  |
| UI / Agent / Tool / Browser / Preview | PASS | `ui.*`、Provider、orchestration、approval、tool、browser、preview、MCP 生命周期均有结构化事件与耗时/结果                                           |
| URL 与 Secret 脱敏                    | PASS | URL 去除 userinfo/query/hash；敏感键与 token 模式递归脱敏，含 fuzz / diagnostics bundle 回归                                                       |
| Screenshot correlation                | PASS | Diagnostics 生成 `evidence.capture`；实测 `ev-dd098bf0-f140-4fb6-9bbd-b9900a2b8849` 与 action `7e40ad25-9adf-4ede-9218-73a2583fad33`、同秒截图关联 |

## 产品面状态

| 面                                      | 状态               | 说明                                                                                      |
| --------------------------------------- | ------------------ | ----------------------------------------------------------------------------------------- |
| Desktop (macOS arm64)                   | 功能完整，验证充分 | 主体产品（Primary）                                                                       |
| Web                                     | Supported          | 保留维护；静态部署、预算内、无后端依赖                                                    |
| VS Code                                 | **PREVIEW**        | 持续演进；不阻塞 Desktop RC                                                               |
| CLI                                     | **PREVIEW**        | 持续演进；不阻塞 Desktop RC                                                               |
| Plugin / Multi-user / Canvas / Ego Lite | **Extended**       | 已交付能力，保留维护并继续优化（优先级管理，非冻结；Ego Lite 需外部安装，集成验证进行中） |

## Provider 成熟度分级（证据驱动，模型级）

分级唯一来源：`src/core/providers/provider-validation.json`（由真实 Provider Golden Tasks Eval 生成）+ `effectiveModelAgentTier`/`effectiveAgentTier`（自 2026-09-11 起解析时**匹配连接端点**：official/gateway/self-hosted 证据互不借用）。证据按 **providerId + modelId + endpointClass** 记录，跨模型/跨端点不借；**每次真实 run（pass/fail/partial）都进历史，当前档位由该模型最新一次真实 run 决定**——新失败覆盖旧通过（Needs Revalidation），suite 版本过期同样强制重验。**2026-09-11 档位门槛复审（E2）**：Agent Verified / Smoke Verified 要求最新一次达标且通过率 ≥90%（0 越权/0 越界）；达标（≥80%、0 越权/0 越界）但 <90% 的新档位 **Eval Candidate**（实测候选）。10 任务冒烟规模永不等于全量验证。README/Settings/本表由 `scripts/check-doc-facts.mjs` 门禁保持一致。

| 档                 | 当前厂商与模型                                                                                      | 依据                                                                          |
| ------------------ | --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Agent Verified     | 暂无（16/20=0.8 未到 ≥90% 门槛）                                                                    | 20 任务全量 + ≥90% + 0 越权/0 越界；**不代表 GLM 系模型**（模型级证据不互借） |
| Eval Candidate     | 智谱 preset · `evomap-deepseek-v4-flash`（EvoMap 网关，DeepSeek 系，2026-09-09 全量 20 任务 16/20） | 最新一次达标（0.8、0 越权/0 越界）但 <90% Verified 门槛                       |
| Smoke Verified     | 暂无（同日 17/20 含 2 越界的一次已如实记 partial 进历史）                                           | 10 任务冒烟规模且 ≥90% 达标档；当前无持有者                                   |
| Needs Revalidation | 暂无（该档在最新真实 run 回归或 suite 升版时自动出现）                                              | 历史曾达标 + 最新回归 → 需重验                                                |
| Protocol Verified  | GLM（智谱）、OpenAI、Anthropic、Google Gemini、Azure OpenAI、Ollama                                 | 协议适配器自动化覆盖；GLM 历史手工真机 QA 见 §真实 Provider 段                |
| Preset             | 其余 30 家                                                                                          | 配置模板                                                                      |

## 缺陷修复（RC Final + Full Regression，全部带回归测试）

| 缺陷 | 修复                                                                                    |
| ---- | --------------------------------------------------------------------------------------- |
| A    | openai 流式 tool_call 分片合并丢名 → tool_not_allowed（`1d9bb3b`）                      |
| C    | 迭代预算耗尽判 failed 丢全部证据（`1d9bb3b`）                                           |
| G    | 验证判 FAILED 但 run 仍 completed（`a27a88b`）                                          |
| L    | paused run 审批节点死锁（`8939185`）                                                    |
| M    | 模型切换器键盘导航陷阱（`6991356`）                                                     |
| N    | 提交入口无防抖 → 并行管线（`cdf304c`）                                                  |
| G2   | 验证 FAILED 结构化标记（`ccb09d5`）                                                     |
| E    | TDD 红阶段 exit 1 误判（`ccb09d5`）                                                     |
| H    | provider 120s 超时 transient 重试（`ccb09d5`）                                          |
| K    | 消息发送静默丢失 → 草稿保留 + 错误行（`ccb09d5`）                                       |
| O    | 新项目 scrollIntoView + 滚动盲区可见性（`ccb09d5`）                                     |
| P    | Web 暴露 Desktop Workspace / Settings 能力 → 运行时能力边界                             |
| Q    | Composer 等整个 run 才清空 → 接受消息即清空且失败时保留                                 |
| R    | 相对工具路径导致 Changes/Outputs 无法读取 → 边界安全解析                                |
| S    | Browser 可观测性不足 → action/browser session/耗时/错误结构化事件                       |
| T    | 日志 URL 泄露 query/hash 风险 → URL 专项脱敏                                            |
| U    | About 许可文案与无 LICENSE 事实不一致 → 明确未选择许可证                                |
| V    | 项目行 hover 操作区遮挡名称 → 悬浮/焦点态为名称预留操作区宽度                           |
| W    | Browser Preview 永久“启动中” → camelCase 事件契约、脚本优先级、启动 watchdog 与失败重试 |

## 待修 / 待验

| 项                 | 说明                                                                                                |
| ------------------ | --------------------------------------------------------------------------------------------------- |
| D 审批卡点击失效   | ✅ fixture 真实编排 5/5；2026-09-01 安装版双击 Reject 只产生一次 `approval.denied`，文件 mtime 不变 |
| G2 补充            | ✅ 结构化 VERIFICATION_STATUS 全链路 ×3 通过（PASS/FAIL/PARTIAL）                                   |
| F 状态一致性       | ✅ 20+ 轮 UI↔DB↔磁盘三方比对无一不一致                                                              |
| 60min 第二有效样本 | #1 已完成（真实写盘 5 文件）；第二样本因 ask profile 逐次审批墙钟 2h 未跑，按需补                   |
| 30min #3 重跑      | Feature 任务修复后待重跑                                                                            |

## Blocking Issues

1. **LICENSE：BLOCKED** — 仓库 public 但无 LICENSE 文件；须负责人决定。禁止代选。
2. Windows 验收未执行（发布 Windows 包前必须完成）。
3. Intel macOS 实机安装未执行；现有 x64 构建不能替代物理机证据。
4. Developer ID 签名与 notarization 凭据不可用；当前仅 ad-hoc。
5. 未提供凭据的 Provider/协议不能做真实外部调用；本轮使用本地 fixture 的结果不替代真实 Provider。
6. 外部 MCP 与 Agent 会话内 MCP Tool 调用未执行；本地 stdio 设置/Runtime 证据不能替代它们。
7. Desktop 目录在当前自动化上下文缺 TCC 权限；不能将其他目录测试冒充该路径通过。
8. VS Code Marketplace publisher 与 CLI npm 发布通道未配置。

## 2026-09-11 Final Polish 轮（本轮追加记录）

不新增评审文档（E5）；本轮事实只追加在此。

- **档位门槛复审（E2）**：Agent Verified / Smoke Verified 提高到最新一次真实评估 ≥90%（0 越权/0 越界）；新增 Eval Candidate（≥80% 且 0/0、<90%）。当前唯一实测模型 `evomap-deepseek-v4-flash`（16/20）由 Agent Verified 改判 **Eval Candidate**；resolveModelTier 解析现按连接端点（official/gateway/self-hosted）过滤证据。README/Settings/本表由更新后的 `check-doc-facts.mjs` 门禁保持一致（含 A2.1 长任务措辞规则）。
- **README 事实修正（A2/A3/A4/E1）**：删除 "GLM 经 EvoMap 网关 18/20" 误标（真实为 DeepSeek 系模型 16/20，18/20 出处为含 3 越界的未入史 run）；Harness Eval 与 Real Model Eval 分行展示；长任务措辞与 readiness 对齐（已有真实样本、仍未取得单次连续 ≥30 分钟 PASS）；升级/降级不再列为未验证（本表已有 PASS 记录）；安装说明如实（ad-hoc 未公证、Gatekeeper 手动允许、无正式 Windows 安装包）。
- **主路径体验修复**：权限引导改为 Composer 上方横幅、X 仅推迟（B1）；项目线程默认打开 Workbench-Changes、显式关闭按项目记忆（B2，<1440px 抽屉形态除外）；工具行以 path+diffstat/命令+exit code 为主字段、L1 成功降噪（B3）；Header 不再重复模型名、运行中 Header 常显 Stop（B4）；Settings 导航降噪（Theme/Language 并入 Personalization、Extended 尾组）；单用户底栏仅 Settings。
- **Correctness**：Ask 档支持行内 "Allow this tool in this project" 范围授权（含审计、换 profile 即失效）（C1）；GUI-PATH 回归门 + 命令未找到可操作提示 + Preview 检测失败与无脚本文案分离（C2）；dev_server IPC 超时缓解 + list 重试（G 缓解，安装版真人复验记录见下）；Knowledge serving/indexing 双轴拆分、重建期间与失败后旧索引仍可检索（F）；Plan/Goal 自然结束但工作未完时有界 continuation（含 no-progress 停止与追踪事件）（H）。
- **Product-level Golden Eval（E3）**：`eval/product-golden/` 五题套件（修真实失败测试 / 拆过大函数 / 加 API 校验 / 只许改 packages-cli 的范围纪律 / 脏工作区不覆盖用户修改），Prompt、范围与断言同源（`tasks.ts` 单一事实），真实模型 runner 与确定性自检（`tasks.spec.ts`，进 CI）齐备。2026-09-11 真实端点（EvoMap `evomap-deepseek-v4-flash`）实跑 Task 01：**PASS**（4/4 检查全绿：目标测试通过、全量 cli 测试 8/8、typecheck 绿、被植入测试未被改动；9 次工具调用、157.6s；修复恰好恢复被植入删除的一行）。结果 JSON 在 `eval/results/product-golden-2026-09-11.json`（本地）与桌面 Evidence；其余 4 题 NOT RUN（本轮要求 ≥1 真实跑，未凑数）。
- **既有失败已清零（本轮 PR4）**：`e2e/comprehensive-qa.spec.ts` 的预存失败（基线 d0c1f45 记录 12 失败/11 通过，双项目口径 14 failed）已于本轮分类修复：**19 passed / 0 failed / 1 有因 capability skip**（分类与证据见"Release Closure 轮"段）。

### 2026-09-11 安装版真人旅程（L1–L5，发布 DMG 覆盖安装，SHA 与构建一致）

证据目录：`~/Desktop/Evir_Desktop_Project_Agent_Final_Polish_Evidence_2026-09-11/`（截图 + 审计摘录）。

- **L1 第一印象：PASS** — 新项目首次进入出现 Composer 上方权限横幅；选择"工作区访问"后横幅消失，Workbench 自动打开且默认落在"变更"；composer/header 干净。
- **L2 真实编码任务（含 STOP+resume）：PASS** — 8-10 分钟真实任务（修 `countWidgets` 去重 + 新增 `summarizeWidgets` 及测试）：计划确认后真实执行；运行中 Header"停止任务"与 Composer 停止双入口可见（证据截图）；中途点击"停止任务"一次即停（流内出现"任务已停止"分隔，运行终止、无后续请求）；以"继续"恢复后 **vitest 5/5 全绿**（模型诚实自纠 `pnpm` 缺失改用 `node_modules/.bin/vitest`）；恢复后 git diff 与停止时完全一致（+30/−3，同两文件同内容）——**无重复副作用**；Changes 面板可审（`count.test.ts +20 −1`、`count.ts +13 −2`，含逐文件复制补丁）。
- **L3 权限对话（允许一次 vs 在此项目允许此工具）：PASS** — 项目切换"逐次审批"后：① `write_file`(L3) 首次询问 → 三按钮卡（拒绝/本次允许/在此项目允许此工具）→ 选"本次允许" → 写入成功（`approval.granted` 08:49:58）；② 同工具再次询问 → 选"在此项目允许此工具" → 写入成功（08:54:22）；③ **后续同工具调用零询问**：审计中 4 次 `permission.auto-approved reason:"scoped-grant" profile:"ask"`（run_command，08:56:49–08:57:27）；授权按工具隔离（write_file 已授权后 run_command 仍询问）。审计摘录存证。
- **L4 App Preview：部分通过，启动 BLOCKED（如实记录）** — 检测 PASS：面板正确识别 `pnpm run dev:web` 并展示启动按钮；确认对话框 PASS（含"会重置当前对话的执行配置"的诚实提示）。**启动未成功**：确认后无进程、无端口、无任何 devserver 日志事件，面板回到初始态。根因与本机环境一致：GUI 应用 PATH 无 `pnpm`（run_command 同因曾报 `program not found: pnpm`，但 run_command 可自纠改用 `node_modules/.bin`，Preview 启动器只支持包管理器且**失败为静默**）。两个待办：devServerStart 复用 command_env 登录探测解析；启动失败需在面板显错并记日志。Stop/Restart/Error+Retry 未达（依赖启动成功）。
- **L5 Knowledge 重建索引回归：PASS（失败路径实机验证）** — 触发"重建索引"真实执行并**诚实失败**：`knowledge.source-reindex-failed error:"folder is outside the project's granted roots"`（来源目录属另一项目，边界判定正确）；失败后旧索引仍 `ready` 可检索（"66 文档 · 1143 分块 · 索引于 2026/9/9"保持 serving，未翻转失败）——即 F 修复的实机确认。"重试成功切换索引"路径由 knowledge-eval（11 绿）与仓库层测试覆盖，本轮未在安装版完成（来源目录按边界不可达）。小缺陷记录：来源状态徽章在中文界面显示原始 i18n 键 `knowledge.sources.state.ready`（未本地化）。
- **旅程期间的其他如实观察**：一次 resume 轮 executor 显示 `profile: null`（项目权限上下文未随 continuation 绑定，退回 allow-once 后备；边界未破、无越权，但应随 run 传递）；一次任务在多次命令失败后最终态显示"任务失败"（文件写入本身成功，模型 `cat`/`pnpm` 环境命令失败计入）——失败态呈现诚实但与文件结果并列时略显严格。

### 2026-09-11 Release Closure 轮（Stable Maintenance 入口收尾，追加记录）

参考基线 `30994a3`；本轮 5 个功能 commit（`36985b5`→`df0f45a`）。证据目录：`~/Desktop/Evir_Release_Closure_Evidence_2026-09-11/`。

- **统一命令执行环境（PR1, `36985b5`）**：run_command / App Preview / Verification（经 run_command 执行器）/ git status·diff·worktree / MCP stdio baseline 全部复用同一 `command_env` 解析（`resolve_executable`：cwd 的 node_modules/.bin → 解析后 login+interactive PATH）。探测决策由"必需 executable 是否真可解析"（node/npm/git）取代目录名启发式（覆盖 nvm/fnm/volta/rustup）。结构化 `CommandExecutionError`（command_not_found/spawn_failed/outside_workspace + cwd + 环境来源）；Preview 启动失败保持 Error 态直到 Retry，不再静默回 Idle；command-not-found 提供"打开命令环境"深链；Diagnostics 增加交互 shell 探测取舍说明；preview 生命周期 trace（spawn-requested/started/ready/stop-requested/exited，不含环境变量值）。cargo command_env 17/17。
- **Continuation 权限上下文（PR2, `0f8fbc1`）**：run/续跑的权限上下文从 conversation 的持久 projectId 恢复（`run-context.ts`；UI 选中态仅 legacy fallback）——resume/approval 续跑/编排续跑继承 projectId、profile、roots、scoped grants；`run.context` 审计行（audit 日志）含 continuationOfRunId/projectId/permissionProfile/scopedGrantCount。安装版实测（本日旅程）：`permissionProfile:"workspace" source:"conversation-project" continuationOfRunId:<原run>`——上轮 L5 观察的 `profile:null` 回归路径封死（单测 9 项）。
- **comprehensive-qa 清零（PR4, `9fe95ac`）**：修复前 14 failed（web+desktop 双项目口径；基线记录的 12 为单项目口径）→ **19 passed / 0 failed / 1 有因 capability skip**。分类：12×B 陈旧测试（Send 空输入禁用契约、语言页并入 Personalization）+ 1×A 真产品 bug（发送接受的清草稿回调在异步持久化后迟到，会把已输入的下一条草稿抹掉；setMessageInput 改函数式条件清空）+ 1×D 既有有因 skip。未删测试、未裸 skip。
- **Knowledge i18n（PR5, `b0ff03f`）**：来源状态徽章 raw key（`knowledge.sources.state.ready`）在 zh/en 补齐；双轴语义"就绪 · 最近一次更新失败"保留可用性表达；测试枚举全部可达状态组合 × 双语言（2/2）。
- **Product Golden 01–05 全部真实执行：5/5 PASS**（真实端点 EvoMap `evomap-deepseek-v4-flash`，当前代码一次性克隆，47 分钟）：01 修真实失败测试（49 工具调用）、02 拆过大函数（47）、03 加 API 校验+测试（48）、04 范围纪律仅 packages/cli（33）、05 脏工作区用户修改保全（56）。全部检查项绿；结果 `eval/results/product-golden-2026-09-11.json`（同日重跑覆盖 01 旧记录，旧记录存证于 Evidence）。无 NOT RUN。
- **Preview 检测 A 类 bug 修复（`df0f45a`）**：`fs_file_stat` 对不存在文件返回 `Ok({exists:false})` 而 detectDevScript 以 try/catch 判存在 → 一切项目被判为 pnpm → 无全局 pnpm 的机器 App Preview 必然 command_not_found（即上轮 L4 Start BLOCKED 的完整根因之一；影响所有 npm 用户）。修复后 detect 正确按 lockfile 选择（回归 3 例）。
- **Release 安装版 App Preview 完整闭环：PASS**（`df0f45a` 构建，installed SHA==build SHA `0180815e…`）：Detect（npm run dev:web）→ ask 确认框（含重置提示）→ Start（真实 npm→node 进程）→ Ready（localhost:4173，§50 trace 落盘）→ 浏览器自动打开+页面真实渲染 → Refresh → Copy URL（剪贴板验证）→ View Logs → **Stop（真人 UI 点击；npm 与 node 子进程全部结束、端口释放、无 zombie）** → Restart → 再次 Ready（新 PID）。§47 Error/Retry：command_not_found 进入 Error 态并保持（不回 Idle）、真实原因文案、"打开命令环境"深链直达诊断（实测 node/npm/npx/git/python3/cargo/rustc 已找到、pnpm 如实未找到）、重试可用。View Logs 在 command_not_found（从未有进程）场景不渲染（设计一致）；本机 pnpm 仅存在于 nvm v24 bin 而活动 node 为 v26 —— 解析后 PATH 无 pnpm 属实机环境事实，产品保持诚实报错。
- **8–10 分钟安装版 Coding Journey：PARTIAL（如实）**：真实端点+安装版+真实项目副本（median bug/variance 任务）。PASS 面：权限 onboarding→编排澄清→计划确认→执行；read/search/diff 工具活跃；**edit 真实落盘**（resume 后 +14/−4 两文件）；**Stop 两次真实 UI 点击**；**Resume 后 run.context 续跑链正确**（continuationOfRunId、workspace profile 继承、无 profile:null）；无重复副作用（diff 单调）；node/npm 命令环境无 os error 2；shell 复核 node --test 4/4 绿（修复前 3/4）。未达成（如实）：应用内 run_command/npm test/自动验证全链未完成——模型两次在编排只读步骤调用写/命令工具被 tool_not_allowed 正确拒绝（产品边界正常），最后一轮停在编排确认门；variance 的测试用例未补。体验观察：编排每轮任务均需计划确认，多轮任务的交互成本高（记录，非本轮范围）。
- **仍 NOT RUN / PARTIAL（更新）**：单次连续 ≥30min PASS（未取得，非本轮 blocker）；外部 MCP HTTP / Agent 会话内 MCP 工具（MCP-1 未做）；Windows/Intel/签名公证（不变）。
