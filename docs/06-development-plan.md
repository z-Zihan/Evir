# Evir 开发计划

## 阶段 0：工程核验与基础完善

交付：React + TypeScript + Vite + Tauri 2、双 Runtime/Capability、i18n、主题、Design Token、质量工具、CI、Provider/Protocol 类型骨架和可运行产品骨架；建立设置路由、Shortcut Registry、Help/Feedback 骨架、Provider 官方链接元数据、统一 LoggerPort、Correlation ID、AGENTS.md 与 Harness 结构测试基础。

验收：`typecheck`、`lint`、`test`、`build:web` 通过；当前平台 Desktop 可启动；README 中英文完整；Provider Preset 与 Protocol Adapter 不耦合。

## 阶段 1：Provider 与纯净聊天 MVP

交付：

- OpenAI Responses、OpenAI Chat Completions、Anthropic Messages、Gemini Interactions/GenerateContent。
- OpenAI-compatible Responses/Chat 与 Anthropic-compatible Messages。
- 国内外首批 Provider Preset、区域/站点、模型发现和手动模型 ID。
- Provider 能力证据、连接测试、真实流式、停止、断线保留、错误分类。
- 模型切换 Coordinator：空闲/流式/跨 Provider/附件/能力/上下文边界，Ask 会话可安全切换。
- Ask 模式、会话管理、Markdown、附件基础。
- 简单个性化、自定义指令与高级 Markdown 管理；Token/Usage 记录与基础统计。
- 应用内快捷键；系统通知设置和权限申请基础设施。
- Web IndexedDB 与 Desktop 分层本地存储/安全存储。

验收：Web 部署后可用至少一个国际、一个国内、一个自定义兼容 Provider 完成真实流式多轮对话；Desktop 同样可用；CORS 失败有明确下一步；个性化可关闭；Usage 能区分准确/估算；未开启时不请求通知权限；达到性能预算。

## 阶段 1.5：企业云与本地模型协议

交付：Azure OpenAI Responses/Chat、AWS Bedrock Converse、Vertex Gemini、Ollama Native；Mistral Native 与 Cohere Chat v2 可按实际优先级并行实现。

验收：认证信息不进入前端日志；企业认证默认 Desktop；本地模型可发现并流式对话。

## 阶段 S：稳定性与体验整改（当前阶段）

> **当前状态：暂停新增能力，优先稳定和体验整改。**
> 阶段 S 完成前，不进入阶段 2 或后续功能开发。

### S1：现有功能与文档一致性审计 ✅

- 审计报告：`docs/reviews/ui-ux-stability-review.md`
- 识别 P0/P1/P2 Bug 清单

### S2：Bug 修复 ✅

- P1 修复：Web 不显示 Agent/Plan、Desktop 默认 Agent、Plan 降级、WorkspaceSelector 移位
- CC 审查修复 7 个核心组件（10 个 bug）

### S3：产品信息架构调整 ✅

- 顶部栏简化：会话标题 + 模式 + 模型
- WorkspaceSelector 移到输入区（Desktop only）
- 设置页 tab 分组：基础/能力/系统/支持

### S4：Desktop 主交互重构 ✅

- Desktop 默认 Agent 模式
- Plan 不作为一级模式
- Ask 保留为可选切换

### S5：Web 主交互简化 ✅

- Web 不展示 Agent/Plan/Workspace（Capability 判断）
- Web 只展示聊天输入

### S6：Agent 对话流与工具调用 UI 重构 ✅

- AgentActivity 组件：工具调用分组到紧凑活动流
- 状态标题 + 进度计数 + 折叠详情
- 审批 UI 内联

### S7：设置页结构整理 ✅

- 11 个 tab 分 4 组，带视觉分隔
- 主题选择移到设置页

### S8：视觉系统统一 ✅

- Tailwind CSS v4 迁移（21 组件）
- 设计 token：Apple 色彩体系、间距、排版
- 旧 globals.css 已删除，统一为 app.css + supplemental.css

### S9：性能与稳定性回归 ✅

- ✅ Web JavaScript gzip 280.06 KB（预算 350 KB，2026-08-07 最终独立构建）
- ✅ 长会话渲染优化：MessageList 组件 memo 化，流式更新不再重渲染历史消息
- ✅ 工具流式事件批量更新：rAF 节流，每次 animation frame 只触发一次 set()
- ✅ 338 个 TypeScript 测试、7 个 Rust 测试、E2E/UI/视觉/无障碍回归通过

### S10：Web/Desktop 真实验收（确定性范围完成，外部验收待办）

- ✅ Web/Desktop Capability：聊天、流式、停止、错误、设置、主题、语言、窄窗口
- ✅ macOS 原生：debug/release 二进制可构建，debug 应用可启动
- ✅ 浏览器 Desktop Runtime：默认 Agent、Ask 切换、设置、键盘、持久化与恢复闭环
- ⬜ 真实 Provider：付费凭据和真实网络条件
- ⬜ Desktop 原生：真实工作区多工具任务、系统权限、签名安装包
- ⬜ Windows：构建、安装和原生 UI
- ⬜ macOS 原生窗口交互：本轮机器锁屏，未把浏览器 Desktop Runtime 结果冒充原生验收

### 阶段 S 完成标准

- 所有 P1 Bug 修复
- 信息架构调整完成
- Agent UI 重构完成
- 视觉系统统一
- 文档与代码一致
- 仓库内确定性 Web + Desktop Runtime 端到端验收通过；真实 Provider、原生任务和跨平台安装作为发布外部门槛单独记录

## 阶段 2：Desktop Agent 与内置工具

交付：Ask/Agent 完整边界、Agent 内部只读规划阶段、Agent Loop、工作区授权、文件/搜索/Patch、受控终端、Git 只读工具、权限分级、审计、取消、Diff 与回滚；接入任务完成、审批和失败系统通知；支持可选 Desktop 全局快捷键。

### 2026-08-07 进度重审

- 阶段 S 仓库内确定性整改已完成，P0/P1 UI 缺陷为 0；不再用单一百分比掩盖外部门槛。
- 真实 Provider、原生 Agent 完整任务、MCP Runtime、签名安装包、Windows 与正式性能测量仍未通过，产品尚未发布就绪。

验收：完成“只读检查并制定计划”和“读取项目 -> 修改 -> 执行验证 -> 汇报”的两个闭环。

## 阶段 3：上下文压缩与记忆

交付：动态 Token Budget、工具结果 Artifact、对话摘要、任务状态摘要、文件引用与 stale 检测、Provider opaque state、模型切换 Handoff、会话/工作/长期记忆、检索与管理 UI；本地 Schema 迁移、隐私会话、备份导出和崩溃恢复基础。默认单模型即可压缩，不要求 Utility Model。

验收：长任务可持续运行，可恢复历史任务，记忆可查看、删除和关闭；厂商工具续轮状态不丢失且不暴露私有推理链。

## 阶段 4：Skill 系统

交付：Skill Schema、Registry、Validator、Router、Loader；内置 Skill；启停、显式选择、自动路由；目录/ZIP 导入；表单和对话创建；预览、测试、导出和卸载；Web 指令型 Skill 与 Desktop 完整 Skill 的兼容检查。

验收：Web 可运行一个指令型 Skill；Desktop 可创建并安装一个完整 Skill；Agent 仅加载相关 Skill；能力不兼容和恶意 Skill 被阻止。

## 阶段 5：MCP Client

交付：Desktop stdio 与 Streamable HTTP Client；Server 管理、能力发现、MCP Tool Adapter、安全存储、最小环境变量、进程管理、审批、审计和调试。Web 保持不支持。

验收：至少连接一个本地和一个远程测试 Server；工具调用经过统一权限系统；断连可恢复或明确失败。

## 阶段 6：通用工具与浏览器自动化（DELAY）

> **状态：DELAY — 代码保留，入口移除，后续按需启用。**
> 浏览器工具代码保留在 src/core/tools/builtin/browser-tools.ts，但未注册到 Runtime。

交付：文档/数据工具、文件整理、Playwright Sidecar、下载/上传保护、Sidecar 生命周期与跨平台产物。Provider 服务端工具在本阶段前后按独立来源接入。

## 阶段 7：Computer Use（DELAY）

> **状态：DELAY — 未开始，后续按需开发。**
> 需要 macOS Accessibility API + Windows UI Automation，工作量大，当前优先级低。

## 并行产品轨：VS Code 扩展与 CLI

这两个产品面复用 Provider Core，但不阻塞 Desktop 主线，也不得通过依赖 Desktop 常驻进程换取实现便利。

### 当前已实现

- VS Code：独立 Evir Activity Bar/Webview、Provider 配置与 SecretStorage、流式 Ask、停止、本地会话、受信任本地工作区 Agent、文件/搜索/Git/命令工具、逐次审批、最后一次写入 Diff/回滚、Extension Host 与 Light/Dark 截图验证。
- CLI：`configure`、`doctor`、`ask`、`agent`、stdin、SIGINT、工作区边界、逐次审批、Desktop 共享非敏感 Provider Profile 与系统凭据、smoke 与 tarball 检查。

### 发布前 P1

- VS Code 在 Webview 中补齐 Agent step/tool/verification/failed/stopped/completed 运行事件，不只在审批时展示工具事实。
- VS Code 把 Tool Calling 标记区分为“用户声明”和“已测试”，补齐角色/ARIA 文案本地化及 High Contrast 验收。
- CLI 将缺少配置参数、Zod 错误和 Provider 错误转换为稳定错误码与可执行下一步。
- CLI 增加中英文人类输出、版本化 JSON/JSONL、稳定 stdout/stderr 与退出码契约。
- 两个产品面补齐真实 Provider、停止、失败恢复、长输出和安装/升级/卸载验收。

### 公开发布门槛

- VS Code：确定 Publisher、许可证、隐私说明、Marketplace 素材；在 VS Code Marketplace/Open VSX 与至少一个兼容编辑器完成真实安装升级。
- CLI：确定 npm 包名/许可证，完成 macOS、Windows、Linux 的 Keyring 与全局/一次性执行验证，审计 tarball 生产依赖和 Secret 泄露。
- Tag 版本与根应用、扩展、CLI 三处 Manifest 一致；发布失败不得复用已推送 Tag。

产品、技术与评审证据见 `docs/19-vscode-extension-and-editor-roadmap.md`、`docs/20-cli-product-and-technical-specification.md` 和 `docs/reviews/vscode-cli-product-ui-review.md`。

## 阶段 8：发布质量

交付：macOS Apple Silicon（`aarch64-apple-darwin`）、macOS Intel（`x86_64-apple-darwin`）和 Windows x64 显式构建矩阵、架构化产物名、签名、公证、自动更新、数据迁移、隐私与许可证；完整本地 Diagnostic/Audit/Crash 日志、日志目录管理、脱敏、滚动与诊断 ZIP 导出；性能基线、包体积检查、内存/CPU/日志开销回归和启动性能门禁。

## 阶段 O：智能任务理解与多 Agent 编排

仓库实现包括 Task Brief、自适应澄清、结构化 DAG、机械校验、事件优先持久化、资源锁 Scheduler、安全检查点暂停恢复、六个内置子图、同模型受限子 Agent、任务工作台及旧运行记录兼容。确定性自动化完成后，默认启用仍以真实 Provider + 原生 Desktop 的“澄清 → 计划 → 并行读取 → 修改 → 审批 → 验证 → Diff → 回滚”通过为门槛；浏览器 fixture 和单元测试不能替代该证据。

## 阶段工作规则

每阶段拆成可验证垂直切片。开始前说明目标、非目标、范围、风险和验收；完成后运行质量门禁、记录真实结果并停止，不跨阶段堆功能。

## 全阶段横向要求

- Ask / Plan / Agent 的 Tool Registry 级边界。
- 国内外 Provider Preset、Protocol Adapter 和模型级能力证据。
- 权限预设与 Network Policy。
- Artifact、导入导出、备份和崩溃恢复。
- Skill 版本、依赖、运行记录和回滚。
- MCP 调试、日志、PID、超时和生命周期。
- 真实流式输出、用量和性能预算。
- 每个功能满足 `docs/12-product-closure-review.md` 的产品闭环门槛。
- 单模型即可完成核心聊天、Agent 和上下文压缩，不引入隐藏的第二模型依赖。
- 模型切换只在安全检查点发生，跨 Provider 明确数据去向。
- Harness Middleware、循环检测、自验证与仓库文档事实来源。
- 全系统本地日志可导出但不可远程后门访问。
