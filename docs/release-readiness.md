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

| 项                                             | 状态    | 证明                                                                                                                                                                                                                                                     |
| ---------------------------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Real EvoMap (GLM, openai-compatible)           | PASS    | 真实 Ask/流式/停止/恢复/错误分类/审批/写盘（2026-08-27/28/29 多轮）                                                                                                                                                                                      |
| Real Agent 多工具任务（真实 Provider）         | PASS    | BugFix 147 次工具执行 3 尝试后完成+独立核验 132 全绿；Refactor shared.js 提取 134 全绿                                                                                                                                                                   |
| 其他协议真机（Anthropic/Gemini/OpenAI 原生等） | NOT RUN | 适配器有测试，未真机取证                                                                                                                                                                                                                                 |
| 回滚（原生点击）                               | PARTIAL | 磁盘级验证 3/3（修改恢复/新建删除/删重命名恢复）通过；安装版回滚入口与确认框已打开并取消。最终确认会删除/恢复本地文件，自动化策略要求用户明确确认，故未点击                                                                                              |
| 30 分钟 Agent 任务                             | PARTIAL | BugFix ✅ 独立核验通过；Refactor ✅（跟进后完成）；Feature ⚠️ 验证器诚实判 FAILED（修复后待重跑）                                                                                                                                                        |
| 60 分钟 Agent 任务                             | PARTIAL | #1（test-docs-site，2026-08-31）真模型全链路 2h：5 文件真实写盘（含 README-BUGFIX.md 缺陷报告+校验工具链），逐次审批/退出码/诚实终态全部按设计；终态 needs_verification（auto-verification `pnpm check` 在纯文档项目不适用）。有效样本 0→1，第二样本待补 |
| 20–50 轮长对话（真实需求变更）                 | PASS    | 20 轮 + 30 轮（含需求变化）各 100% 完成，上下文保持（2026-08-31）                                                                                                                                                                                        |
| 超长工具输出 / Context 压缩实机                | PARTIAL | 压缩层级单测过；原生长输出场景未取证                                                                                                                                                                                                                     |
| MCP：设置与本地 stdio Runtime                  | PASS    | 连接测试发现 1 tool；enable→Ready；restart→新 PID 且 Ready；disable 后恢复原状态（2026-09-01）                                                                                                                                                           |
| MCP：Agent 会话内审批取证                      | NOT RUN | 仅完成 Runtime 与设置页链路；不可冒充 Agent 会话工具调用                                                                                                                                                                                                 |
| MCP：HTTP / 外部真实 Server / Windows          | PARTIAL | 不可用 HTTP fixture 得到明确 `Load failed`；外部真实 Server 与 Windows 未验证                                                                                                                                                                            |

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

## 日志与证据关联（2026-09-01）

| 项                                    | 状态 | 证明                                                                                                                                               |
| ------------------------------------- | ---- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Correlation IDs                       | PASS | `sessionId/windowId/projectId/threadId/runId/planId/toolCallId/browserSessionId/actionId/evidenceId` 可按链路携带                                  |
| UI / Agent / Tool / Browser / Preview | PASS | `ui.*`、Provider、orchestration、approval、tool、browser、preview、MCP 生命周期均有结构化事件与耗时/结果                                           |
| URL 与 Secret 脱敏                    | PASS | URL 去除 userinfo/query/hash；敏感键与 token 模式递归脱敏，含 fuzz / diagnostics bundle 回归                                                       |
| Screenshot correlation                | PASS | Diagnostics 生成 `evidence.capture`；实测 `ev-dd098bf0-f140-4fb6-9bbd-b9900a2b8849` 与 action `7e40ad25-9adf-4ede-9218-73a2583fad33`、同秒截图关联 |

## 产品面状态

| 面                    | 状态               | 说明                         |
| --------------------- | ------------------ | ---------------------------- |
| Desktop (macOS arm64) | 功能完整，验证充分 | 主体产品                     |
| Web                   | 稳定               | 静态部署、预算内、无后端依赖 |
| VS Code               | **PREVIEW**        | 不阻塞 Desktop RC            |
| CLI                   | **PREVIEW**        | 不阻塞 Desktop RC            |

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
