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

一个纯净、本地优先、用户自带模型的多模型 AI 客户端与通用桌面 Agent。

**接入一个支持工具调用的大模型，即可开始使用 Evir Desktop 操作文件、代码、终端与电脑。**

[English](README.en.md) · [产品文档](docs/01-product-requirements.md) · [开发计划](docs/06-development-plan.md) · [Coding Agent Prompt](prompts/coding-agent-master-prompt.md)

</div>

---

## 产品速览

|                |                                                                                                              |
| :------------- | :----------------------------------------------------------------------------------------------------------- |
| **它是什么**   | 用户自带模型、数据本地优先、跨 Web / Desktop / VS Code / CLI 的多模型 AI 客户端与通用 Agent。                |
| **核心承诺**   | 不绑定模型厂商，不强制账号，不用积分体系；本地能力有权限边界，执行过程可停止、可审计、可回滚。               |
| **最短路径**   | 配置一个模型即可开始；Ask 用于对话分析，Desktop Agent 在明确授权后操作文件、代码、终端与电脑。               |
| **产品边界**   | Web 专注聊天与附件；Desktop 承载通用 Agent；VS Code 与 CLI 是可独立安装、独立运行的工程入口。                |
| **当前成熟度** | 阶段 S：稳定性与体验整改。自动化覆盖较完整，但真实 Provider、原生多工具任务、签名安装包与 Windows 仍需验收。 |

```text
你的模型  →  Evir Harness  →  权限与工具  →  可验证的任务结果
 Provider     Context / Loop     Approve / Audit     Diff / Snapshot / Recovery
```

**快速导航：** [为什么是 Evir](#为什么是-evir) · [产品形态](#多种产品形态一套核心能力) · [核心体验](#核心体验) · [隐私与本地存储](#隐私与本地存储) · [当前状态](#当前状态) · [本地开发](#本地开发) · [完整文档](#文档)

## 为什么是 Evir

很多 AI 客户端把核心体验包裹在账号、积分、订阅、广告和平台限制中。Evir 采用另一条路线：

- **自带模型**：连接国内外主流模型厂商、本地模型或自定义兼容端点。
- **数据本地优先**：会话、任务、记忆、Skill 和配置默认留在用户设备。
- **能力透明**：模型能否流式输出、调用工具、识别图片，会在使用前明确展示。
- **操作可控**：桌面端的文件、终端、MCP 和电脑操作需要权限评估，可停止、可审计、可回滚。
- **产品纯净**：无广告、无积分、无强制账号、无必需业务后端。
- **轻量高性能**：基于 Tauri 2，按需加载工具、Skill、MCP 与 Sidecar，不用完整 Chromium 换取开发便利。
- **单模型即可启动**：不强制配置第二个压缩模型、Embedding 服务、Skill、MCP 或 Evir 后端。
- **本地可诊断**：覆盖全系统的脱敏日志、审计与诊断包，由用户主动导出，不存在远程日志后门。

## 多种产品形态，一套核心能力

### Evir Web

部署到静态服务器即可使用的多模型聊天客户端。

- 用户自带 API Key、Base URL 和模型。
- 真实流式输出、Markdown、附件、多会话、本地搜索。
- 多语言、亮色、暗色与跟随系统主题。
- Ask 聊天与附件分析；不提供 Plan、Agent 或系统级电脑操作。
- 浏览器直连模型 API，不依赖 Evir 云端后端。

> 某些模型服务不允许浏览器跨域直连。Evir Web 会检测并明确提示，用户可改用 Evir Desktop 或配置允许浏览器访问的端点。

### Evir Desktop

基于 Tauri 2 的 macOS / Windows 通用 Agent。

在 Web 能力之上增加：

- 工作区、文件系统、终端和 Git。
- Agent Loop、任务计划、上下文压缩与记忆。
- 权限审批、执行审计、文件 Diff、快照与回滚。
- 内置 Skill、用户导入与创建 Skill。
- MCP 服务器配置管理；真实 stdio / Streamable HTTP 连接闭环仍在开发中。
- 后续支持浏览器自动化和 Computer Use。

### Evir for VS Code

可独立打包为 `.vsix` 的编辑器扩展，不要求 Evir Desktop 常驻运行。

- BYOM Provider、Base URL、模型和 API Key 配置；密钥存入 VS Code SecretStorage。
- Ask 流式问答、停止和本地会话保存。
- 受信任本地工作区中的 Agent 文件、搜索、Git 和命令工具。
- 写文件和执行命令逐次审批；最后一次文件写入支持 Diff 和回滚。
- 当前不支持 VS Code Web、Remote SSH/WSL、MCP、Skill 和 Desktop 会话同步。

VSCodium、Cursor 和 Windsurf 等 VS Code 兼容编辑器可能直接安装同一 VSIX，但尚未逐项验收。JetBrains、Zed 和 Neovim 需要独立 Runtime Adapter，详见 [VS Code 扩展与编辑器路线](docs/19-vscode-extension-and-editor-roadmap.md)。

### Evir CLI

可独立安装的 `evir` 命令行工具，不要求先安装或启动 Desktop。

- `evir configure` 配置 Provider，并把 API Key 写入系统安全凭据库。
- `evir ask` 提供流式问答；`evir agent --workspace <path>` 在工作区边界内运行 Agent。
- Desktop 与 CLI 共享默认 Provider 的非敏感配置和系统凭据；任一端更新后，另一端下次读取即可使用。
- `EVIR_API_KEY` 可作为当前进程的临时最高优先级覆盖，不会写入配置或日志。

## 核心体验

### 多模型，而不是绑定单一厂商

Evir 使用“**Provider Preset + Protocol Adapter + Model Capability**”三层设计：

```text
Provider Preset
  负责厂商名称、默认地址、区域与认证表单
        ↓
Protocol Adapter
  负责 OpenAI Responses / Chat Completions、Anthropic Messages、Gemini、Bedrock 等协议
        ↓
Model Capability
  记录具体模型是否支持流式、工具、图片、结构化输出和上下文长度
```

计划内置国内外主流 Provider 预设，同时支持：

- OpenAI Responses API
- OpenAI Chat Completions API
- Anthropic Messages API
- Google Gemini Interactions / GenerateContent
- Azure OpenAI Responses / Chat Completions
- Amazon Bedrock Converse / ConverseStream
- Mistral、Cohere 和 Ollama 原生协议
- OpenAI-compatible、Anthropic-compatible 自定义端点

完整清单见 [Provider 与协议矩阵](docs/13-provider-and-protocol-matrix.md)。

### Ask / Plan / Agent

- **Ask**：对话和分析，不自主读取或操作本地资源。
- **Plan**：Desktop Agent 的内部只读规划阶段，不是当前一级模式入口。
- **Agent**：按权限策略执行工具，可暂停、取消、审批和回滚。

当前 Web 只呈现 Ask；Desktop 呈现 Ask/Agent。

### Skill 与 MCP

- Skill 负责告诉 Agent **如何完成一类任务**。
- MCP 负责向 Agent 提供 **外部工具、资源和提示词**。
- Web 支持不依赖本地工具的指令型 Skill；Desktop 当前支持 Skill 和 MCP 配置管理，MCP 连接、发现与运行时调用仍在开发中。
- 第三方 Skill 和 MCP 默认不可信，必须经过能力检查和权限系统。

### 个性化，但不牺牲安全

- 通过简单表单设置称呼、语言、表达方式和长期工作偏好。
- `USER.md`、`PERSONA.md`、`INSTRUCTIONS.md` 和 `SOUL.md` 高级编辑器尚未开放。
- Evir 核心安全、权限、工具和网络规则不可编辑，也不能被 Skill 或自定义指令覆盖。
- 个性化支持全局、工作区和当前会话作用域，并可一键关闭。

### 基础体验完整

- 通知基础接口已预留；当前设置界面尚未提供系统通知开关。
- 本地 Token 与用量统计，明确区分厂商准确值与估算值。
- 设置页可查看当前应用内快捷键；自定义、命令面板和 Desktop 全局快捷键尚未开放。
- 仓库提供中英文离线帮助文件；应用内帮助中心和反馈表单尚未开放。
- Provider 配置页提供对应官网、控制台、官方文档和状态页。

### 单模型开始，安全切换

- 用户完成 Provider、API Key 和模型配置后即可开始使用。
- Ask 只要求文本生成能力；Desktop Agent 要求模型支持可靠的 Tool Calling。
- 模型可在会话中切换，但 Evir 会处理上下文上限、工具能力、附件兼容、数据去向和 Provider 私有状态。
- Agent 运行中切换模型会先停在安全检查点并生成结构化 Handoff，不能在工具执行中静默替换。
- 默认不跨 Provider 自动回退，避免成本和数据流向失控。

### Harness 与本地日志

Evir 将 Agent 视为 `Model + Harness`：模型负责判断，Harness 负责上下文、权限、工具、循环检测、验证、恢复和可观测性。仓库内文档、测试和架构约束共同构成 Agent 可读取的事实来源。

日志系统覆盖 Provider、流式响应、Agent、Context、Tool、MCP、Storage、性能和崩溃，但默认脱敏并只保存在本地。用户可在设置中导出诊断 ZIP，再自行发送给他人或附加到 GitHub Issue；Evir 不提供远程读取本地日志的后门。

## 隐私与本地存储

Evir 不需要云端数据库。

```text
API Key                 → 系统安全凭据库
Desktop / CLI Provider  → 版本化非敏感本地配置
主题、语言等简单设置     → 本地配置
会话、任务、记忆等结构数据 → 嵌入式本地存储
日志、Diff、快照、生成文件 → Artifact 文件目录
```

Desktop 默认使用 SQLite 作为嵌入式本地 Adapter。它只是用户电脑上的一个文件，不监听端口，也不需要单独安装数据库服务。

## 性能原则

- Desktop 冷启动目标：P50 < 2 秒，P95 < 4 秒。
- 空闲内存目标：不高于 150 MB；回归警戒线 200 MB。
- 空闲 CPU 长时平均目标：低于 1%。
- Web 初始 JavaScript gzip 目标：不高于 350 KiB；只打包 10 个共享 Skill。
- Desktop 前端资源目标：不高于 15 MiB；包含共享 10 个与额外 26 个 Desktop-only Skill。
- 不含可选 Sidecar 的桌面安装产物目标：不高于 120 MiB；180 MiB 为回归警戒线。
- 流式增量到达后目标 100 ms 内呈现。
- 不在启动时加载全部 Skill、启动全部 MCP 或扫描整台电脑。

这些是工程预算，必须通过真实测量验证，不能仅凭主观判断“轻量”。

## 当前状态

Evir 当前处于**阶段 S：稳定性与体验整改**，不是发布就绪产品。

- Web 定位为聊天与附件分析，不展示 Agent、Plan、本地工作区或 MCP。
- Desktop 默认 Agent，可切换 Ask；Plan 不作为常驻一级入口。
- 本地工具、审批、Agent Activity、工作区和基础恢复链路已实现并有自动化覆盖。
- Web/Desktop Capability 已覆盖 E2E、视觉、无障碍、主题、语言和窄窗口矩阵。
- macOS 原生窗口已完成基础启动烟测；真实 Provider、原生多工具任务、签名安装包和 Windows 仍需验收。

当前证据见 [自动化质量报告](docs/reviews/automated-quality-report.md) 和 [稳定性缺陷登记](docs/reviews/stability-bug-register.md)。

## 本地开发

### 环境

- Node.js 20+
- pnpm 9+
- Rust stable
- Tauri 2 对应系统依赖

### 命令

```bash
pnpm install
pnpm dev:web
pnpm dev:desktop
pnpm build:web
pnpm build:desktop
pnpm build:desktop:macos:arm64
pnpm build:desktop:macos:x64
pnpm build:desktop:windows:x64 # 在 Windows 上执行
pnpm build:vscode
pnpm package:vscode
pnpm build:cli
pnpm check
pnpm test:e2e
pnpm test:ui
pnpm test:visual
pnpm test:a11y
pnpm benchmark
```

macOS 与 Windows 正式安装包需要在对应系统构建。稳定版 Git Tag 会触发 GitHub Actions，并显式生成 Apple Silicon（`arm64`）、Intel（`x64`）两个 macOS DMG 和 Windows x64 MSI，汇总到同一个 Release。M1/M2/M3/M4 用户选择 `arm64`，Intel Mac 用户选择 `x64`；两个 macOS 包不能互相替代。

可以不打 Tag 直接在本地打包。Apple Silicon Mac 可用上述两个 macOS 命令分别生成 arm64 与 x64 DMG；Windows x64 安装包必须在 Windows 本机或 Windows CI Runner 上生成。本地未配置签名证书时产物仅适合测试。完整的 Rust target 安装命令、产物路径和 Tag 发布步骤见[开发指南](docs/03-development-guide.md#101-本地打包)。

## 文档

- [产品需求](docs/01-product-requirements.md)
- [技术架构](docs/02-technical-architecture.md)
- [开发指南](docs/03-development-guide.md)
- [设计规范](docs/04-design-specification.md)
- [工程规范](docs/05-engineering-standards.md)
- [开发计划](docs/06-development-plan.md)
- [Agent 安全与质量](docs/07-agent-security-and-quality.md)
- [Skill 与 MCP](docs/08-skill-and-mcp.md)
- [本地存储、Artifact 与恢复](docs/09-storage-artifacts-and-recovery.md)
- [流式输出与性能](docs/10-streaming-and-performance.md)
- [Provider、权限与可观测性](docs/11-provider-permissions-and-observability.md)
- [产品闭环审查](docs/12-product-closure-review.md)
- [Provider 与协议矩阵](docs/13-provider-and-protocol-matrix.md)
- [个性化、通知、用量、快捷键、反馈与帮助](docs/14-personalization-notifications-usage-shortcuts-feedback-help.md)
- [最终体验、模型切换与上下文策略](docs/15-final-experience-model-switching-and-context.md)
- [Evir Harness Engineering](docs/16-harness-engineering-for-evir.md)
- [本地日志与诊断系统](docs/17-local-logging-and-diagnostics.md)
- [最终产品审查 V6](docs/18-final-product-review-v6.md)
- [VS Code 扩展与编辑器路线](docs/19-vscode-extension-and-editor-roadmap.md)
- [CLI 产品与技术规格](docs/20-cli-product-and-technical-specification.md)
- [VS Code 与 CLI 产品/UI 评审](docs/reviews/vscode-cli-product-ui-review.md)
- [Coding Agent Prompt](prompts/coding-agent-master-prompt.md)

## Repository

```text
git@github.com:z-Zihan/Evir.git
```

## License

许可证将在正式开源发布前确定。引入第三方依赖时必须记录并核验其许可证。
