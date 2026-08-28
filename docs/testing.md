# Evir 测试策略（Canonical）

> 本文档只描述测试层级：测什么、为什么测、什么时候跑、通过标准是什么。
> 具体测试用例目录见 `docs/23-full-project-test-cases.md`；当前逐项验证状态见 `docs/release-readiness.md`；历史执行记录在 `docs/archive/`。

## 层级总览

| 层级                       | 内容                                                                          | 触发                                   | 通过标准                                      |
| -------------------------- | ----------------------------------------------------------------------------- | -------------------------------------- | --------------------------------------------- |
| L1 Unit                    | 纯函数、Store、Repository、Parser、脱敏、边界校验                             | 每次 PR/main（`pnpm check` 内 vitest） | 全过，0 skip（能力边界除外）                  |
| L2 Integration             | Runtime ↔ Provider Adapter ↔ Tool Execution ↔ Permission ↔ Storage 连接       | 每次 PR/main（同上）                   | 全过                                          |
| L3 Fixture E2E             | Playwright 驱动 Web/浏览器 Desktop UI 与交互（本地 fixture Provider，零配额） | PR 重点跑 core；全矩阵按需             | core 全过；能力边界 skip 须注明原因           |
| L4 Visual / A11y / UI 矩阵 | 视觉基线、axe 无障碍、响应式/主题/语言矩阵                                    | 变更涉及 UI 时；发布前全量             | 基线比对过；axe 0 违规                        |
| L5 Benchmark               | 产物体积与预算（Web gzip / 桌面前端 / Skill 分块）                            | push main（benchmark.yml）             | 全部预算 `pass`；有意变化须同 PR 更新基线     |
| L6 Native Desktop（macOS） | release 构建实机：Provider 配置、项目路径、审批、真实写盘、重启持久化、性能   | 每个收口/发布候选轮（手动）            | 关键旅程有实机证据，fixture 证据不替代        |
| L7 Real Provider           | 真实模型（当前 EvoMap / GLM，openai-compatible）冒烟与任务                    | 发布候选（手动/计划），**不进日常 CI** | 精确 token 往返、停止、恢复、错误分类真实取证 |
| L8 Long-running / Stress   | 30–60 分钟 Agent 任务、20–50 轮长对话、千级消息 UI、超长工具输出              | 发布候选（手动）                       | 无死循环、无 Context 失控、内存/CPU 在预算内  |
| L9 Windows                 | 安装、路径（中文/空格/C:\）、Shell、凭据库、升级、崩溃恢复                    | 发布候选（Windows Runner）             | 实机安装与核心旅程通过                        |

## 原则

1. **证据分级**：Unit/Integration 证明逻辑；Fixture E2E 证明 UI 行为；Native/Real Provider 证明真实产品。上层不得由下层冒充（浏览器 Desktop 页面 ≠ 原生宿主；fixture ≠ 真实 Provider）。
2. **零配额优先**：能用本地 fixture 服务器（`e2e/fixtures/provider-server.mjs`，支持 `[agent-task]`/`[agent-recovery]` 脚本化 tool_calls 与错误注入）验证的，不用真实 API。
3. **不伪造 PASS**：没有执行就是 NOT RUN；`docs/release-readiness.md` 是唯一当前状态来源。
4. **本地 = CI**：日常质量统一走 `pnpm check`（已包含 Rust 测试，勿重复执行 `test:rust`）；打包/签名只在 tag 阶段（release.yml）；体积预算独立在 push main（benchmark.yml）。

## 命令速查

```bash
pnpm check                 # format + lint + strict TS + vitest + cargo test + workflow 校验 + VS Code + CLI（日常唯一入口）
pnpm test:rust             # 同上中的 Rust 部分，单独重跑时用
pnpm test:e2e              # core E2E（web + desktop）
pnpm test:ui / test:visual / test:a11y / test:stress
pnpm benchmark             # 产物体积门禁（更新 docs/benchmarks/latest.json）
```
