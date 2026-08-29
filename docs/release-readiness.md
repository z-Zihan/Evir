# Evir Release Readiness — 当前验证状态

> 本文档是**当前版本验证程度的唯一来源**。状态只允许基于实际代码、测试、运行记录、CI 与真机验证填写。
> 基线：2026-08-28 晚（RC 真实环境验证轮进行中；fix eed8dd8 已入库：vault 损坏不 panic + 真单实例）。上一轮完整整改记录：`docs/archive/`。
> 状态语义：`PASS`（有当期证据）· `PARTIAL`（部分证据/部分场景）· `NOT RUN`（未执行）· `BLOCKED`（被外部条件阻塞）· `FAIL`。

## 构建与静态质量

| 项                               | 状态 | 证据                                                    |
| -------------------------------- | ---- | ------------------------------------------------------- |
| Format / Lint / strict Typecheck | PASS | `pnpm check`（2026-08-28）                              |
| TypeScript Unit + Integration    | PASS | vitest 682 用例（2026-08-28）                           |
| VS Code 扩展测试                 | PASS | 8 用例（2026-08-28）                                    |
| CLI 测试                         | PASS | 8 用例（2026-08-28）                                    |
| Rust 测试                        | PASS | cargo test 37 用例；fmt/clippy 干净（2026-08-28）       |
| Web 构建                         | PASS | `pnpm build:web`（2026-08-28，CI 同款命令）             |
| Desktop 前端构建                 | PASS | benchmark 流程内（2026-08-28）                          |
| 日常 CI（PR/main）               | PASS | quality.yml 自本轮起在 PR/main 运行 `pnpm check` + Rust |

## E2E 与矩阵（fixture，零配额）

| 项                        | 状态 | 证据                                                            |
| ------------------------- | ---- | --------------------------------------------------------------- |
| Core E2E（web+desktop）   | PASS | 40 过 / 10 能力跳过（2026-08-28）                               |
| UI 矩阵 / 视觉基线 / a11y | PASS | 2/2、6/6、18/18（2026-08-28 上午批次）                          |
| 压力与边界（fixture）     | PASS | 1003 会话 / 500 消息 / 102K prompt / 102 项目（2026-08-28）     |
| Benchmark 预算            | PASS | Web gzip 290.3 KiB、桌面前端 2.69 MiB（latest.json 2026-08-28） |

## 原生 Desktop

| 项                             | 状态    | 证据                                                                                                                                                    |
| ------------------------------ | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| macOS arm64：构建 + DMG        | PASS    | Evir.app + DMG 6.47 MiB（2026-08-28，ad-hoc）                                                                                                           |
| macOS arm64：实机核心旅程      | PASS    | Provider 配置→测试连接→中文/空格路径建项目→计划确认→L3 审批→真实写盘→读回验证→重启持久化（2026-08-28）                                                  |
| macOS arm64：性能              | PASS    | 冷启动 0.84s、空闲内存 ~71 MB、空闲 CPU 0%（2026-08-28）                                                                                                |
| macOS x64：构建                | PASS    | x64 DMG 可产出（2026-08-26 本地）                                                                                                                       |
| macOS x64：实机安装            | NOT RUN | 无 Intel 实机证据                                                                                                                                       |
| Windows：全部                  | NOT RUN | MSI 可产出；安装/路径/Shell/凭据/升级未验                                                                                                               |
| 正式签名 / 公证                | NOT RUN | 可选增强（ad-hoc 为默认交付）。密钥已改存本地加密 vault（AES-256-GCM），重建不再触发钥匙串授权框（2026-08-28 实机复验：重建后启动零弹窗、既有配置完整） |
| 升级 / 降级 / 迁移             | NOT RUN | —                                                                                                                                                       |
| Crash Recovery（真实崩溃场景） | NOT RUN | 检测逻辑有单测，未做真实崩溃取证                                                                                                                        |

## 真实 Provider 与长任务

| 项                                             | 状态    | 证据                                                        |
| ---------------------------------------------- | ------- | ----------------------------------------------------------- |
| Real EvoMap (GLM, openai-compatible)           | PASS    | 真实 Ask/流式/停止/恢复/错误分类（2026-08-27 实机轮）       |
| Real Agent 多工具任务（真实 Provider）         | PASS    | 读取→审批写入→约束保持→预期失败表达（2026-08-26/27 实机轮） |
| 其他协议真机（Anthropic/Gemini/OpenAI 原生等） | NOT RUN | 适配器有测试，未真机取证                                    |
| 回滚（原生点击）                               | NOT RUN | 快照/恢复单测+E2E 过；2026-08-26 实机点击回滚遗留未补       |
| 30 分钟 Agent 任务                             | NOT RUN | —                                                           |
| 60 分钟 Agent 任务                             | NOT RUN | —                                                           |
| 20–50 轮长对话（真实需求变更）                 | NOT RUN | fixture 千消息过，真实多轮未测                              |
| 超长工具输出 / Context 压缩实机                | PARTIAL | 压缩层级单测过；原生长输出场景未取证                        |
| MCP：Agent 会话内审批取证                      | NOT RUN | Runtime 与设置页已验证                                      |
| MCP：外部真实 Server / Windows                 | NOT RUN | —                                                           |

## 产品面状态

| 面                    | 状态               | 说明                                                           |
| --------------------- | ------------------ | -------------------------------------------------------------- |
| Desktop (macOS arm64) | 功能完整，验证充分 | 主体产品                                                       |
| Web                   | 稳定               | 静态部署、预算内、无后端依赖                                   |
| VS Code               | **PREVIEW**        | 功能子集可用；Marketplace/High Contrast/完整本地化未验收       |
| CLI                   | **PREVIEW**        | configure/doctor/ask/agent 可用；错误友好度/退出码/i18n 未收口 |

## RC 轮新增证据（2026-08-28 晚，真实 EvoMap/GLM + 真实 UI 操作）

| 项                          | 状态    | 证据                                                                                                                                                                        |
| --------------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 单实例强制                  | PASS    | tauri-plugin-single-instance：二次启动聚焦既有窗口、无第二进程                                                                                                              |
| 冷启动 ×5                   | PASS    | 2239/497/303/319/316ms（中位 319ms，首启含冷缓存）                                                                                                                          |
| 空闲资源                    | PASS    | RSS 39–95MB、CPU 0.0%                                                                                                                                                       |
| Standalone Chat（真实模型） | PASS    | 中文/MD/代码块/长文流式；中途停止保留部分内容（status=stopped）；重新生成原地替换无重复；多轮上下文（三句话总结前文）；**0 次工具调用**（Ask 不触本地）                     |
| Journey A（持久环境）       | PASS    | 真实目录选择建项目→intake 澄清卡→61 次只读工具调用→准确项目分析                                                                                                             |
| Provider 真实故障恢复       | PASS    | EvoMap 连接错误→诚实中文错误卡（已重试 2 次）→点重试→任务恢复并完成                                                                                                         |
| 执行前确认分层              | PASS    | 工作区自动执行权限下，计划执行节点仍要求显式确认（文案解释原因）                                                                                                            |
| 60 分钟真实工程任务         | PARTIAL | chorus 镜像（396 文件真实 TS 项目）：intake→澄清→计划确认→执行中（80+ 工具调用时点快照），自主运行于工作区权限                                                              |
| WKWebView 跨应用缓存串页    | 发现    | 同机其他 Tauri 应用（tauri://localhost 同源）缓存可短暂串入本应用首帧（Chorus dev 在跑时观察到"欢迎页"一帧）。建议后续为窗口配置独立 origin。非数据安全问题，记录为已知问题 |

## Security Decisions

- **Secret Storage（Release Security Decision）**：正式版继续使用本地 AES-256-GCM vault（`secret-vault.json`），不切 OS 钥匙串。原因：ad-hoc/频繁重建二进制会触发 macOS ACL 弹窗并可能丢失密钥；vault 满足"非明文、防误分享、用户名派生加密上下文绑定"的目标。它不是抵御本地文件读取攻击者的硬件级存储（威胁模型见 `src-tauri/src/secret_vault.rs` 头注释与 docs/09）。若未来启用稳定签名的正式分发，可再评估 OS-backed（Keychain/DPAPI/Secret Service）作为首选、vault 作为回退——本轮不实施，避免高风险迁移。
- **单实例**：`tauri-plugin-single-instance` 强制（二次启动聚焦既有窗口），vault/SQLite 不再存在跨进程写竞争；进程内另有互斥锁。

## Blocking Issues

1. **LICENSE：BLOCKED** — 仓库 public 但无 LICENSE 文件；须负责人在 MIT / Apache-2.0 / GPLv3 / AGPLv3 中决定（差异备查：MIT 最宽松；Apache-2.0 含专利授权；GPL/AGPL 强 Copyleft，AGPL 连网络服务使用也触发开源义务）。禁止代选。
2. Windows 验收未执行（发布 Windows 包前必须完成）。
3. VS Code Marketplace publisher 与 CLI npm 发布通道未配置。
