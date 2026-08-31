# Evir Release Readiness — 当前验证状态

> 本文档是**当前版本验证程度的唯一来源**。状态只允许基于实际代码、测试、运行记录、CI 与真机验证填写。
> 基线：2026-08-31（RC Final Defect Fix + Retest 轮；最新 commit ccb09d5）。上一轮记录：`docs/archive/`。
> 状态语义：`PASS`（有当期证据）· `PARTIAL`（部分证据/部分场景）· `NOT RUN`（未执行）· `BLOCKED`（被外部条件阻塞）· `FAIL`。

## 构建与静态质量

| 项                               | 状态 | 证据                                                        |
| -------------------------------- | ---- | ----------------------------------------------------------- |
| Format / Lint / strict Typecheck | PASS | `pnpm check`（2026-08-31）                                  |
| TypeScript Unit + Integration    | PASS | vitest 728 用例（2026-08-31）                               |
| VS Code 扩展测试                 | PASS | 8 用例（2026-08-31）                                        |
| CLI 测试                         | PASS | 8 用例（2026-08-31）                                        |
| Rust 测试                        | PASS | cargo test 46 用例（含 vault 损坏矩阵）（2026-08-31）       |
| Web 构建                         | PASS | `pnpm build:web`（2026-08-31）                              |
| Desktop 前端构建                 | PASS | `pnpm build:desktop:frontend`（2026-08-31）                 |
| 日常 CI（PR/main）               | PASS | quality.yml + windows-sanity（Rust check + frontend build） |

## E2E 与矩阵（fixture，零配额）

| 项                        | 状态 | 证据                                                        |
| ------------------------- | ---- | ----------------------------------------------------------- |
| Core E2E（web+desktop）   | PASS | web-e2e / web-ui / web-visual / web-a11y 全绿（2026-08-31） |
| UI 矩阵 / 视觉基线 / a11y | PASS | 视觉基线更新+人工复核；axe button-name 95→0（2026-08-31）   |
| 压力与边界（fixture）     | PASS | 1003 会话 / 500 消息 / 102K prompt / 102 项目               |
| Benchmark 预算            | PASS | Web gzip < 300 KiB；桌面前端 < 3 MiB（2026-08-31）          |

## 原生 Desktop

| 项                             | 状态    | 证明                                                                                                                                                   |
| ------------------------------ | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| macOS arm64：构建 + DMG        | PASS    | Evir.app + DMG（2026-08-31，覆盖安装 ×5+ 次均 SHA256 一致）                                                                                            |
| macOS arm64：实机核心旅程      | PASS    | Provider 配置→测试连接→项目创建→任务管线→审批→写盘→恢复（2026-08-28/29/31 多轮）                                                                       |
| macOS arm64：性能              | PASS    | 冷启动 0.27–1.22s（均值 0.70s）、空闲 RSS 75.6MB / CPU 0.0%（2026-08-31）                                                                              |
| macOS x64：构建                | PASS    | x64 DMG 可产出（2026-08-26 本地）                                                                                                                      |
| macOS x64：实机安装            | NOT RUN | 无 Intel 实机证据                                                                                                                                      |
| Windows：全部                  | BLOCKED | 无真机。windows-sanity CI job 保留（Rust check + frontend build）                                                                                      |
| 正式签名 / 公证                | NOT RUN | 可选增强（ad-hoc 为默认交付）。密钥存本地加密 vault（AES-256-GCM）                                                                                     |
| 升级 / 降级 / 迁移             | PASS    | DMG 覆盖升级 ×5+：每次 SHA256 一致、59 会话 / 43 runs / 578 消息全量留存、vault 完好                                                                   |
| Crash Recovery（真实崩溃场景） | PASS    | A: SIGTERM / B: 流式中 kill / C: kill -9 + WAL 并发 / D: 主进程+WebContent 双杀 / E: 裸 kill -9 —— 5/5 全过，3344 实体零丢失、vault 完好（2026-08-31） |

## 真实 Provider 与长任务

| 项                                             | 状态    | 证明                                                                                              |
| ---------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------- |
| Real EvoMap (GLM, openai-compatible)           | PASS    | 真实 Ask/流式/停止/恢复/错误分类/审批/写盘（2026-08-27/28/29 多轮）                               |
| Real Agent 多工具任务（真实 Provider）         | PASS    | BugFix 147 次工具执行 3 尝试后完成+独立核验 132 全绿；Refactor shared.js 提取 134 全绿            |
| 其他协议真机（Anthropic/Gemini/OpenAI 原生等） | NOT RUN | 适配器有测试，未真机取证                                                                          |
| 回滚（原生点击）                               | PARTIAL | 磁盘级验证 3/3（修改恢复/新建删除/删重命名恢复）通过；原生 UI 点击回滚按钮待补                    |
| 30 分钟 Agent 任务                             | PARTIAL | BugFix ✅ 独立核验通过；Refactor ✅（跟进后完成）；Feature ⚠️ 验证器诚实判 FAILED（修复后待重跑） |
| 60 分钟 Agent 任务                             | PARTIAL | #1（test-docs-site，2026-08-31）真模型全链路 2h：5 文件真实写盘（含 README-BUGFIX.md 缺陷报告+校验工具链），逐次审批/退出码/诚实终态全部按设计；终态 needs_verification（auto-verification `pnpm check` 在纯文档项目不适用）。有效样本 0→1，第二样本待补 |
| 20–50 轮长对话（真实需求变更）                 | PASS    | 20 轮 + 30 轮（含需求变化）各 100% 完成，上下文保持（2026-08-31）                                 |
| 超长工具输出 / Context 压缩实机                | PARTIAL | 压缩层级单测过；原生长输出场景未取证                                                              |
| MCP：Agent 会话内审批取证                      | NOT RUN | Runtime 与设置页已验证                                                                            |
| MCP：外部真实 Server / Windows                 | NOT RUN | —                                                                                                 |

## UI / UX Final Redesign（2026-08-31 实施）

| 项               | 状态 | 证明                                                                              |
| ---------------- | ---- | --------------------------------------------------------------------------------- |
| CSS Tooltip 系统 | PASS | 替换 52 处原生 title；方向翻转 + max-content + 双主题验证；axe 0 violation        |
| a11y 可访问名    | PASS | tooltip 运行时镜像 data-tip→aria-label（button-name 95→0）；模型切换器 aria-label |
| 侧栏拖拽调宽     | PASS | 200–420px 拖拽 + 持久化 + 双击重置；5 单测；显式格位防 auto-placement 回归        |
| 侧栏横向溢出     | PASS | projects / conversations 区 overflow-x: hidden                                    |
| 行操作按钮浮层   | PASS | 不透明背景 + 边框 + 阴影，不再透出底层文字                                        |
| 连点防护         | PASS | 4 个提交入口同步抢占 phase，杜绝并行管线（连点 12 次只执行 1 次）                 |
| 视觉基线更新     | PASS | 3 个 web 项目 --update-snapshots + 人工逐张复核                                   |

## 产品面状态

| 面                    | 状态               | 说明                         |
| --------------------- | ------------------ | ---------------------------- |
| Desktop (macOS arm64) | 功能完整，验证充分 | 主体产品                     |
| Web                   | 稳定               | 静态部署、预算内、无后端依赖 |
| VS Code               | **PREVIEW**        | 不阻塞 Desktop RC            |
| CLI                   | **PREVIEW**        | 不阻塞 Desktop RC            |

## 缺陷修复（RC Final 轮，全部带回归测试）

| 缺陷 | 修复                                                               |
| ---- | ------------------------------------------------------------------ |
| A    | openai 流式 tool_call 分片合并丢名 → tool_not_allowed（`1d9bb3b`） |
| C    | 迭代预算耗尽判 failed 丢全部证据（`1d9bb3b`）                      |
| G    | 验证判 FAILED 但 run 仍 completed（`a27a88b`）                     |
| L    | paused run 审批节点死锁（`8939185`）                               |
| M    | 模型切换器键盘导航陷阱（`6991356`）                                |
| N    | 提交入口无防抖 → 并行管线（`cdf304c`）                             |
| G2   | 验证 FAILED 结构化标记（`ccb09d5`）                                |
| E    | TDD 红阶段 exit 1 误判（`ccb09d5`）                                |
| H    | provider 120s 超时 transient 重试（`ccb09d5`）                     |
| K    | 消息发送静默丢失 → 草稿保留 + 错误行（`ccb09d5`）                  |
| O    | 新项目 scrollIntoView + 滚动盲区可见性（`ccb09d5`）                |

## 待修 / 待验

| 项                | 说明                                                     |
| ----------------- | -------------------------------------------------------- |
| D 审批卡点击失效  | ✅ fixture 真实编排 5/5 通过（2026-08-31）                |
| G2 补充           | ✅ 结构化 VERIFICATION_STATUS 全链路 ×3 通过（PASS/FAIL/PARTIAL） |
| F 状态一致性      | ✅ 20+ 轮 UI↔DB↔磁盘三方比对无一不一致                   |
| 60min 第二有效样本 | #1 已完成（真实写盘 5 文件）；第二样本因 ask profile 逐次审批墙钟 2h 未跑，按需补 |
| 30min #3 重跑     | Feature 任务修复后待重跑                                 |

## Blocking Issues

1. **LICENSE：BLOCKED** — 仓库 public 但无 LICENSE 文件；须负责人决定。禁止代选。
2. Windows 验收未执行（发布 Windows 包前必须完成）。
3. VS Code Marketplace publisher 与 CLI npm 发布通道未配置。
