<picture>
  <source media="(prefers-color-scheme: dark) and (max-width: 600px)" srcset="./assets/readme-hero-mobile-dark.svg">
  <source media="(max-width: 600px)" srcset="./assets/readme-hero-mobile-light.svg">
  <source media="(prefers-color-scheme: dark)" srcset="./assets/readme-hero-dark.svg">
  <source media="(prefers-color-scheme: light)" srcset="./assets/readme-hero-light.svg">
  <img alt="Evir — 你的模型，你的电脑，你的 Agent" src="./assets/readme-hero-light.svg" width="100%">
</picture>

<div align="center">

# Evir

**你的模型，你的电脑，你的 Agent。**

一个纯净、本地优先、用户自带模型的 **Desktop Project Agent**：打开一个项目，告诉 Evir 要完成什么，它安全地读、改、运行、验证，并让你清楚看到它做了什么、改了什么、哪里失败、是否真的完成。

**接入一个支持工具调用的大模型即可开工**——无账号、无积分、无云端后端。

[English](README.en.md) · [产品需求](docs/01-product-requirements.md) · [开发指南](docs/03-development-guide.md)

</div>

---

![Evir Desktop：侧栏 Projects 与 Chats，项目任务中的 Agent 执行时间线](assets/readme/desktop-overview.png)

## Desktop Project Agent（主产品）

Desktop 侧栏分为 **PROJECTS** 和 **CHATS** 两区。一个 Project 对应一个本地目录：在项目里新建任务后，Agent 的工作目录就是项目根目录。项目线程是一个**工作台**，不是聊天窗：

- **任务流** — 你的指令、Agent 的每一步工具调用、审批卡、结果摘要按工作顺序排列；每次文件修改直接显示 `路径 +diffstat`，点击即开 Diff。
- **Context Workbench（右栏）** — 产出 / 变更 / 文件 / 预览 / 浏览器。Agent 修改代码后自动切到**变更**（你在看预览/浏览器时只加角标，不抢焦点）；每文件 diffstat、复制补丁、回滚一应俱全。
- **可驾驶** — 运行中随时 Stop，下一条指令可排队（任务结束自动发送）；顶栏常显任务状态（准备中/运行中/验证中/待审批）。

```text
创建 Project（选择目录） → 新建任务 → 选择 Permission / Model
→ Evir 判断是否需要工具 → 读取 · 修改 · 执行 · 验证 → Diff / 快照 / 回滚
```

- **默认 Project Task**：普通问答直接回复；需要操作项目时，按权限策略使用 13 个内置工具（读/写/搜索/patch/命令/git/快照）与 MCP 工具，可暂停、审批、回滚。Plan / Goal 通过 `/plan`、`/goal` 触达。
- **Plan**：只用只读工具检查项目并产出结构化计划，一键 **Execute Plan** 转入 Agent 执行。
- **Goal**：面向长期目标，附带“完成条件”；Evir 用真实证据逐条验证，模型说“完成”不算完成。

### 权限决定自动程度

![项目权限：Ask for Approval / Workspace Access / Full Access](assets/readme/project-permission.png)

第一次打开项目时由你明确选择：**Workspace Access**（推荐，项目内自动放行并写入审计）或 **Ask every time**（更谨慎，写操作逐次审批）。**Full Access** 解除目录边界，首次开启必须明确确认。工具边界在 Tool Registry 与 Rust 侧双层强制，不靠提示词约束。

## 自带模型（BYOM）——按成熟度分级

“能聊天 ≠ 能工具调用 ≠ 能稳定跑完 Project Agent 任务”。Provider 分为三级，设置页与下表如实标注：

| 分级                  | 含义                                                      | 厂商                                                   |
| --------------------- | --------------------------------------------------------- | ------------------------------------------------------ |
| **Agent Verified**    | 真实端点跑过 Golden Agent Tasks（见 [Agent Eval](eval/)） | GLM（智谱）                                            |
| **Protocol Verified** | 流式 + 工具调用协议有自动化覆盖                           | OpenAI、Anthropic、Google Gemini、Azure OpenAI、Ollama |
| **Preset**            | 配置模板，无 Agent 级验证                                 | 其余 30 家内置预设                                     |

Provider、协议、模型能力三层分离：已实现 7 种协议适配器（OpenAI Chat Completions / Responses、Anthropic Messages、Gemini、Azure OpenAI、Ollama 原生、OpenAI-compatible），支持自定义兼容端点。API Key 存本地加密 vault（AES-256-GCM），密钥永远不进日志。

![Provider 设置：多厂商、多模型、能力标记与成熟度徽标](assets/readme/provider-settings.png)

模型能力（流式、工具调用、图片、结构化输出）在使用前明确展示；不支持工具调用的模型仍可在 Project 中聊天，但不会获得项目工具。完整矩阵见 [Provider 与协议矩阵](docs/13-provider-and-protocol-matrix.md)。

## 产品面与成熟度

**Evir Desktop 是主产品**；其余产品面按真实成熟度标注，不并列营销：

| 产品面                                  | 成熟度                   | 说明                                                            |
| --------------------------------------- | ------------------------ | --------------------------------------------------------------- |
| **Desktop**                             | **Primary**              | 全部核心产品设计优先；Agent Eval 优先；macOS / Windows 优先     |
| Web                                     | Maintenance              | 纯净多模型聊天，不复制 Desktop Agent 能力                       |
| VS Code                                 | Preview                  | 编辑器内 Agent（配置/Ask/Agent/审批/Diff 回滚）；只修阻断性 bug |
| CLI                                     | Preview                  | `evir` configure/doctor/ask/agent；只维护核心契约               |
| Plugin / Multi-user / Canvas / Ego Lite | **Experimental（Labs）** | 冻结扩张，默认不作为核心能力宣传                                |

## Skill：质量优先

内置 Skill 分两层：**15 个核心编码 Skill**（systematic-debugging、test-driven-development、code-review、security-review、verification-before-completion 等，面向 Coding / Project Agent 主路径精选）+ **通用可选包**（办公、写作、分析等，设置里可自选启用）。Skill 数量不是 KPI——核心 Skill 的价值由 [Agent Eval](eval/) 对照验证。

## 本地优先与可诊断

```text
API Key            → 本地加密 vault（AES-256-GCM）
Provider 配置       → 版本化非敏感本地文件
会话 / 任务 / 记忆  → 嵌入式本地存储（SQLite / IndexedDB）
日志 / Diff / 快照  → 本地文件目录
```

- 无账号、无积分、无广告、无必需云端后端；数据默认留在你的设备。
- 日志覆盖 Provider / Agent / 工具 / 审批 / 性能，默认脱敏、本地保存、滚动清理；**无远程读取日志的后门**，诊断包由你手动导出。
- 上下文压缩、三层记忆、检查点与崩溃恢复内置；单个模型即可完成全部压缩，不强制第二模型。

## 质量与验证

- **确定性测试**：`pnpm check`（format + lint + strict TS + 全部单测 + Rust 测试 + 发布校验）+ E2E / UI / 视觉 / 无障碍矩阵。当前基线数字以 [Release Readiness](docs/release-readiness.md) 为唯一事实源，不在 README 里复制会漂移的数字。
- **Agent Eval**：20 个 Golden Agent Tasks 跑在冻结 fixture 仓库上（`pnpm test:agent-eval`），指标含成功率、越权操作（必须为 0）、越界修改（必须为 0）、恢复、证据。真实 Provider 档未消耗配额前如实标 **NOT RUN**。
- 性能预算与实测数字以 [最近一次基准](docs/benchmarks/latest.json) 为准（Web 初始 JS gzip ≤ 350 KiB、桌面前端 ≤ 15 MiB、冷启动 P50 < 2s）。

## 当前状态

Evir 仍在积极开发中，**尚未发布**（无 LICENSE 文件，见下方说明）。核心链路（聊天、Agent 工具与审批、Plan/Goal、权限档位、快照回滚、MCP 连接、日志与诊断导出）已实现。**逐项验证状态（含 NOT RUN / BLOCKED 清单）以 [Release Readiness](docs/release-readiness.md) 为准**：Windows、30–60 分钟长任务、升级/降级等尚未验证。安装包默认 ad-hoc 签名（可正常运行）；Developer ID 签名/公证为可选增强。

## 本地开发

```bash
pnpm install
pnpm dev:web        # Web 开发服务器
pnpm dev:desktop    # Tauri Desktop（需 Rust + Tauri 2 依赖）
pnpm check          # format + lint + strict TS + 全部单测 + Rust 测试 + 发布校验
pnpm test:e2e       # Playwright E2E（web + desktop 模式）
pnpm test:agent-eval # Agent Eval：20 个 Golden Tasks（§80 独立输出）
pnpm benchmark      # 产物体积门禁
```

构建与发布（macOS arm64/x64 DMG、Windows x64 MSI、VSIX、CLI tarball）见[开发指南](docs/03-development-guide.md)。要求 Node.js 20+、pnpm 9+、Rust stable。

## 文档

- 当前状态与事实索引：[Release Readiness](docs/release-readiness.md) · [项目记忆索引](docs/agent/Evir-project-memory.md)
- 产品与架构：[产品需求](docs/01-product-requirements.md) · [技术架构](docs/02-technical-architecture.md)
- 规范：[设计](docs/04-design-specification.md) · [工程](docs/05-engineering-standards.md) · [Agent 安全与质量](docs/07-agent-security-and-quality.md)
- 专项：[Skill 与 MCP](docs/08-skill-and-mcp.md) · [Provider 矩阵](docs/13-provider-and-protocol-matrix.md) · [Agent Eval](eval/README.md)

## License

许可证将在正式开源发布前确定。引入第三方依赖时必须记录并核验其许可证。
