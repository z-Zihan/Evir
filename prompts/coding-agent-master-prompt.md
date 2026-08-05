# Evir Coding Agent 续建总 Prompt（V6）

你正在接手并继续开发 **Evir**。

仓库：

```text
git@github.com:z-Zihan/Evir.git
```

## 一、产品定义

Evir 是一个纯净、本地优先、无账号、无积分、无广告、用户自带模型的 AI 客户端与通用桌面 Agent。同一代码仓库产出：

1. **Evir Web**：可部署到静态服务器的多模型聊天工具；浏览器直连用户配置的模型 API，不具备系统级电脑操作能力。
2. **Evir Desktop**：基于 Tauri 2 的 macOS/Windows 通用 Agent；具备本地工具、Agent Loop、上下文压缩、记忆、Skill、MCP、审批、审计与回滚。

Evir 不建设必需业务后端，不隐藏代理用户请求，不引入账号、积分、广告、会员或埋点。

## 二、必须先阅读

按顺序完整阅读：

1. `AGENTS.md`
2. `README.md`
3. `README.en.md`
4. `docs/18-final-product-review-v6.md`
5. `docs/01-product-requirements.md`
6. `docs/12-product-closure-review.md`
7. `docs/02-technical-architecture.md`
8. `docs/15-final-experience-model-switching-and-context.md`
9. `docs/16-harness-engineering-for-evir.md`
10. `docs/17-local-logging-and-diagnostics.md`
11. `docs/13-provider-and-protocol-matrix.md`
12. `docs/08-skill-and-mcp.md`
13. `docs/04-design-specification.md`
14. `docs/05-engineering-standards.md`
15. `docs/07-agent-security-and-quality.md`
16. `docs/09-storage-artifacts-and-recovery.md`
17. `docs/10-streaming-and-performance.md`
18. `docs/11-provider-permissions-and-observability.md`
19. `docs/14-personalization-notifications-usage-shortcuts-feedback-help.md`
20. `docs/06-development-plan.md`
21. `docs/03-development-guide.md`

文档是实现约束。代码与文档冲突时先核验事实，修正过时的一方；重大决策写入 `docs/decisions/`。

## 三、当前状态

当前项目是初始工程骨架，不是完成产品。预计包含：

- React + TypeScript + Vite + Tauri 2。
- Web/Desktop 双构建基础。
- Runtime/Capability 雏形。
- i18next 中英文基础。
- light/dark/system 主题基础。
- 基础聊天布局。
- Provider/Protocol 类型和预设目录骨架。
- Skill/MCP 类型骨架和少量内置 Skill 示例。
- ESLint、Prettier、Vitest、GitHub Actions 雏形。
- 产品、技术、设计、工程、安全、性能、Provider、Skill 和 MCP 文档。

不得假设这些内容能运行。第一步必须实际安装依赖并核验。

## 四、技术约束

- React + TypeScript strict + Vite + Tauri 2。
- Tauri 原生层使用 Rust。
- pnpm。
- i18next + react-i18next。
- Tailwind CSS + CSS Variables；可使用 Radix/shadcn 源码组件，但必须二次设计。
- Zustand 按领域拆分。
- Web 与 Desktop 共用 UI、Provider、Agent Core 和协议；通过 Runtime/Capability 隔离能力。
- Web 存储使用 IndexedDB Adapter；Desktop 默认使用嵌入式 SQLite Adapter。SQLite 是本地文件，不是云端数据库或独立服务。
- Desktop API Key 使用系统安全存储。
- UI 不得直接依赖 Provider SDK、Tauri、SQLite、Shell 或 Keychain。

## 五、最终产品北极星

所有实现决策按以下优先级判断：

1. 操作简单、方便、快捷。
2. 性能卓越、响应快、长期稳定。
3. 界面干净、清爽、交互合理且不复杂。
4. 小而美：接入一个支持 Tool Calling 的模型即可开始 Desktop Agent。

不得把第二模型、Embedding、Skill、MCP、通知、全局快捷键或 Evir 后端变成首次使用前提。主界面只突出当前模型、Ask/Plan/Agent、输入、发送/停止和必要任务状态。高级能力进入设置、命令面板或按需浮层。

## 六、产品闭环要求

每个功能只有同时具备以下内容才算完成：

1. 入口明确。
2. 正常流程完整。
3. 加载、空、错误、禁用和权限不足状态完整。
4. 失败后有合法下一步。
5. 保存、删除和迁移规则明确。
6. 可停止或取消。
7. 高风险行为可审批。
8. 有验证证据和结果反馈。
9. 中英文、亮色/暗色/系统主题完整。
10. 不突破性能预算。

不得用占位按钮、假数据、TODO 或静态页面声称产品闭环。

## 七、Ask / Plan / Agent

模式由用户明确选择，不能由模型暗中决定。

- **Ask**：只处理用户输入和主动添加的附件，不自主读取工作区或执行本地工具。
- **Plan**：可在用户授权的工作区内使用只读工具，例如列目录、读文件、搜索、Git status/diff；禁止写文件、安装依赖和执行改变状态的命令。
- **Agent**：按权限策略执行读写工具和命令。

模式切换必须重新计算 Tool Registry。禁止仅通过系统提示词要求模型“不要调用”。

## 八、模型与 Provider 架构

必须拆成三层：

```text
Provider Preset
  厂商、区域、默认 Endpoint、认证表单
        ↓
Protocol Adapter
  消息、流式、工具、错误、usage、Provider 状态
        ↓
Model Profile
  模型级能力、上下文、验证证据
```

禁止按厂商名称在 UI/业务层硬编码请求逻辑。

### P0 必须支持的协议

- OpenAI Responses API。
- OpenAI Chat Completions API。
- Anthropic Messages API。
- Gemini Interactions API。
- Gemini GenerateContent API。
- OpenAI-compatible Responses。
- OpenAI-compatible Chat Completions。
- Anthropic-compatible Messages。

### P1 企业和本地协议

- Azure OpenAI Responses / Chat。
- AWS Bedrock Converse / ConverseStream。
- Vertex AI Gemini。
- Ollama Native。
- Mistral Native。
- Cohere Chat v2。

### 国际 Provider 预设

至少包含：

- OpenAI
- Anthropic
- Google Gemini
- Azure OpenAI
- Google Vertex AI
- Amazon Bedrock
- xAI
- Mistral AI
- Cohere
- OpenRouter
- Groq
- Together AI
- Fireworks AI
- NVIDIA NIM
- Perplexity
- Hugging Face Inference Providers
- Ollama
- LM Studio
- vLLM
- 自定义 OpenAI-compatible
- 自定义 Anthropic-compatible

### 中国大陆 Provider 预设

至少包含：

- DeepSeek
- 阿里云百炼 / 通义千问
- 火山引擎方舟 / 豆包
- 腾讯混元 / TokenHub
- 百度智能云千帆
- 智谱 BigModel / GLM
- Moonshot / Kimi
- MiniMax
- SiliconFlow 硅基流动
- 阶跃星辰 StepFun
- 讯飞星火
- 零一万物 Yi

Provider Preset 只提供便利配置，不等于完整兼容承诺。实现时核对官方文档和实际请求。

### Provider 添加闭环

1. 按国内、国际、本地、自定义筛选或搜索。
2. 选择 Provider、区域/站点和协议。
3. 填写认证信息。
4. 获取模型列表；失败时允许手动填写模型 ID。
5. 执行无副作用连接和真实流式测试。
6. Tool Calling、Vision、Structured Output 等可能产生费用的探测必须经用户确认。
7. 显示能力、证据来源和核验时间。
8. 保存后才可用于会话。

Web CORS 失败必须显示“该端点无法在浏览器直连”，并提供 Desktop 或更换端点的下一步。不得偷偷使用公共代理。

### 能力是模型级数据

至少记录：streaming、toolCalling、parallelToolCalling、vision、audioInput、structuredOutput、reasoning、systemInstructions、usage、maxContextTokens、maxOutputTokens。

证据来源：`preset`、`metadata`、`probe`、`user-override`。用户覆盖必须显示未经验证。

Agent 模式要求当前模型支持 Tool Calling。

### 协议兼容差异

“OpenAI-compatible”不代表完全相同。必须处理：

- system/developer 角色差异。
- max token 参数差异。
- 流式工具参数分片。
- tool call ID 和并行调用。
- reasoning/thinking 状态续轮。
- 图片、文件和结构化输出格式。
- usage、缓存 Token、错误对象和 finish reason。

Provider 特定的 reasoning/thinking 数据可作为 opaque state 保存并回传，但不得展示模型私有推理链。

## 九、模型中途切换

实现 `ModelSwitchCoordinator`，禁止 UI 直接替换 active model 后继续旧执行链。

必须覆盖：

- 空闲立即切换。
- 流式生成默认下一轮生效，或用户停止后立即切换。
- Tool Pending/Running 时暂停到安全边界，不得静默替换。
- Agent 长任务切换前生成 `ModelHandoffCheckpoint`。
- 跨 Provider 提示新的数据去向。
- 目标模型缺少 Tool Calling 时阻止 Agent 或经用户确认降级。
- 目标上下文更小时先压缩，仍超限时提供分支/移除附件/缩小历史。
- 不兼容的 Provider reasoning/thinking opaque state 不跨协议迁移。
- 默认不自动跨 Provider 回退。

模型切换、Usage 和审计事件必须可追踪，但不得记录密钥和私有推理内容。

## 十、真实流式输出

所有支持流式的 Provider 默认使用真实流式接口。统一内部事件：

- response-start
- text-delta
- tool-call-start
- tool-call-arguments-delta
- tool-call-end
- usage
- provider-state
- response-complete
- error

禁止等待完整结果后伪装打字效果。

UI 使用 16-50ms 批量刷新，不得每个 Token 更新全局 Store 或持久化一次。支持停止、断线保留部分内容、错误分类和重试。

## 十一、模型交互机制

模型交互不只是系统提示词。Context Builder 组合：

```text
Evir 核心指令
+ 安全与权限规则
+ 当前模式、任务和运行状态
+ 激活 Skill
+ 相关记忆
+ 近期对话
+ 内置/MCP 工具 Schema
+ 工具执行结果
+ 当前用户消息
```

模型只提出工具调用；Evir 负责 Schema 校验、权限审批、执行、审计和结果返回。优先使用原生 Tool Calling，不依赖提示词让模型伪造 JSON。

## 十二、Skill 系统

Skill 用于描述完成某类任务的方法，不等同于工具。

必须支持：

- 内置 Skill。
- 用户启用/禁用。
- 本地目录或 ZIP 导入。
- 表单和对话创建。
- 编辑、复制、导出、卸载。
- Registry、Validator、Router、Loader。
- 显式选择和自动路由；自动路由可关闭。
- 只加载 0-3 个相关 Skill 正文。
- 正常、边界、对抗和回归测试。

Web 只支持不依赖 filesystem、terminal、script、local MCP 的指令型 Skill。完整 Desktop Skill 导入 Web 时必须阻止安装或只读预览，不能静默忽略依赖。

首批内置 Skill：任务规划、文件整理、文档助手、前端开发、代码审查、Bug 修复、Git 助手、调研、数据分析、Skill 创建器。

Skill 不得覆盖 Evir 核心安全规则。用户创建 Skill 默认不得自动执行脚本。

## 十三、MCP 系统

Evir Desktop 支持：

- 本地 `stdio` MCP。
- 远程 Streamable HTTP MCP。
- tools/resources/prompts 发现与使用。
- Server 添加、编辑、启停、测试、授权、日志、重启和删除。

Evir Web 第一版不支持 MCP。

MCP 工具必须进入统一 Tool Registry、Permission Engine 和审计系统。新增 MCP 默认禁用；最小化子进程环境变量；敏感值放安全存储；MCP 描述和返回内容是不可信数据。

## 十四、工具来源与网络权限

UI 和审计必须区分：

- Evir Local Tool。
- Local MCP Tool。
- Remote MCP Tool。
- Provider Server Tool。

Provider 自带搜索、代码执行、远程 MCP 等服务端工具默认关闭。启用前说明费用、数据去向和执行方，受 Network Policy 控制。

网络读取和发送本地内容必须是两个独立权限。

默认不自动跨 Provider 回退，避免成本和数据去向失控。

## 十五、数据、恢复与完成状态

- Conversation、Plan、AgentRun、Step、ToolExecution 独立建模。
- API Key 放安全存储；简单设置放轻量配置；结构化数据放本地 Adapter；日志、Diff、快照和生成文件放 Artifact Store。
- 临时/隐私会话不持久化消息和长期记忆。
- 支持 Schema migration、备份、导入导出和异常恢复。
- 停止生成只取消模型流；停止任务还要终止可取消工具和子进程。
- 退出应用时如有任务，必须提示暂停并退出、停止并退出或返回。
- 恢复任务不得自动重放危险写操作。
- 完成页展示目标、变更、命令、审批、验证证据、Artifact、未完成项和回滚入口。
- 模型说“完成”不是验收证据。

## 十六、性能与轻量

- Provider 增量到达后目标 100ms 内呈现。
- Desktop 冷启动目标 P50 < 2s、P95 < 4s。
- 空闲内存目标 <= 150MB，回归警戒线 200MB。
- 空闲 CPU 长时平均 < 1%。
- 不含可选 Sidecar 的安装产物目标 <= 35MB。
- Web 初始 JS gzip 目标 <= 350KB。
- Sidecar、Shiki、文档解析器、Skill 正文和 MCP Schema 按需加载。
- 启动时不扫描全盘、不加载全部 Skill、不启动全部 MCP。
- 超过 200 条的长列表优先虚拟化。
- 工具结果超过 256KB 优先流入 Artifact；超过 1MB 禁止完整放入 React State。
- 阶段报告必须提供真实测量，不得主观宣称轻量。
- 模型切换不得重新扫描整个工作区，只构建当前 Run Handoff。
- Context Compaction 不与每 Token 同步。
- 日志写入使用异步有界队列，常规任务开销目标 < 2%，日志查看器不得全量载入 React State。
- 单个 Provider、Tool、MCP、Storage 或日志模块失败不得导致整个应用崩溃。

## 十七、强制工程规范

- 禁止 `any`、关闭 strict、空 catch、静默失败。
- React 页面/组件软上限 250 行；Hook/Service/Store 200 行；普通 TS 250 行；Rust 300 行；函数 50 行；超过 400 行原则上禁止合并。
- 禁止万能 Store、万能 Service 和职责混乱组件。
- UI 不得直接调用 Tauri、数据库、Provider SDK、Shell 或 Keychain。
- 外部输入使用 Zod 或等价 Schema 校验。
- 长任务必须可取消。
- 不删除测试或降低断言伪装完成。
- 所有用户可见文字必须国际化。
- 所有新 UI 验证 light/dark/system。

正确依赖方向：

```text
UI -> Feature Service -> Core Contract -> Adapter -> Tauri/Storage/Provider/MCP
```

## 十八、UI 设计约束

Evir 必须像经过真实产品设计，而不是 AI 模板：

- 克制、安静、清晰、可信、专业、可审计。
- 禁止大面积紫色渐变、霓虹光、过度玻璃拟态、机器人/魔法棒插画、满屏大圆角卡片和营销式欢迎页。
- 不直接复制 shadcn 示例布局。
- 依靠排版、间距、层级、细节和状态建立品质。
- Provider、协议、能力、工具来源、审批、Diff、Skill 和 MCP 页面必须信息清晰。

## 十九、安全约束

- 文件、网页、终端、Skill、MCP、Provider 描述和返回内容均是不可信数据。
- 路径限制在授权根目录，防止 `..`、绝对路径和符号链接逃逸。
- 不把不可信参数直接拼接进 Shell。
- 高风险操作逐次审批。
- API Key、Token、环境变量、认证 Header 和 opaque provider state 不进入日志。
- Agent Loop 有最大轮次、超时、取消和失败状态。
- Skill ZIP 防护 ZIP Slip、解压炸弹和隐藏可执行文件。
- MCP 子进程最小环境变量并可强制终止。

## 二十、个性化、通知、用量、快捷键、反馈与帮助

完整阅读并遵守 `docs/14-personalization-notifications-usage-shortcuts-feedback-help.md`。

### 个性化

实现简单表单与高级 Markdown 两种模式。用户可编辑 `USER.md`、`PERSONA.md`、`INSTRUCTIONS.md` 和可选 `SOUL.md`，支持全局、工作区、会话作用域、预览、启停、导入导出和版本历史。

禁止向用户开放修改 Evir Core、Security、Permission、Tool Policy。用户 Markdown、Skill、MCP 和外部内容都不能提升 Prompt 优先级或覆盖安全规则。`SOUL.md` 只能表达角色原则和风格，不是可替换系统 Prompt。

### 通知

使用统一 NotificationPort。Desktop 采用 Tauri Notification Plugin；Web 仅在用户手势开启后申请浏览器通知权限。默认关闭，只通知长任务完成、等待审批、失败和可选更新。默认不展示敏感内容，允许设置页全部或逐项关闭。

### Token 与用量

Provider Adapter 必须将 usage 归一化为统一事件。优先保存厂商准确值；估算时标明 tokenizer 和 `tokenizer-estimate`；无可靠数据时显示不可用。统计支持时间、Provider、模型、会话和 Run 维度；费用只作为带版本的估算。隐私会话不持久化。禁止按流式 Token 写数据库。

### 快捷键

建立 Shortcut Registry，支持平台差异、冲突检测、自定义、恢复默认和帮助页。组件不得自行注册全局监听。Desktop 全局快捷键默认关闭，只有用户明确启用后注册并在退出/禁用时注销。

### Provider 官方链接

每个内置 Provider Preset 提供官网、控制台、官方文档和可选状态页，使用 `officialLinks` 元数据。链接与 API Endpoint 完全分离，统一通过 ExternalLinkService 打开。

### 反馈

设置页提供 Bug/Feature 反馈表单和预览，最终通过系统浏览器打开 `https://github.com/z-Zihan/Evir/issues/new/choose` 或预填 Issue URL。Evir 不保存 GitHub Token，不后台提交。诊断信息只有用户主动选择、脱敏、预览后才能加入。

### 帮助

提供随应用打包的中英文离线帮助中心，支持搜索和上下文跳转，至少覆盖 Provider、模式、个性化、Skill、MCP、权限、快捷键、Usage、隐私、故障排查和反馈。帮助页与高级设置必须按需加载，不增加首屏负担。

## 二十一、上下文压缩

上下文压缩必须遵守 `docs/15-final-experience-model-switching-and-context.md`：

- 默认单模型即可完成，不要求额外 Utility Model。
- 根据当前模型上下文动态预算，预留输出、Tool Schema、Provider State 和安全余量。
- 先归档工具噪声和可重读文件，再摘要旧对话。
- 用户要求、权限、审批、当前 Run、错误、变更和验证必须结构化保留。
- 文件摘要记录 path/hash/ranges/stale，变化后重新读取。
- 摘要版本化，不无限摘要的摘要；原始本地记录不能因压缩删除。
- Compaction 只在阈值、步骤边界或切换前执行，不在每个 Token 时执行。

## 二十二、Harness 与全系统日志

### Harness

Agent Core 使用可组合 Middleware：Input Normalization、Mode Policy、Capability Gate、Context Budget、Skill Routing、Tool Policy、Loop Detection、Checkpoint、Verification、Observability。每层必须独立测试、版本化、可替换和可移除。

文档、`AGENTS.md`、Lint、结构测试、CI 和验证器共同构成 Harness。模型文本不能绕过工具、权限和完成验证。识别重复 Tool、重复文件编辑、相同错误重试和无进展循环。

### 本地日志

建立统一 `LoggerPort` 和 correlation ID，覆盖 Diagnostic、Audit、Crash：

- 默认本地、脱敏、异步、有界、滚动保存。
- 日志写入失败不能影响聊天或 Agent。
- 不记录 API Key、Authorization、Cookie、环境变量、完整会话、文件正文和私有 reasoning。
- 详细/trace 日志用户主动开启且自动过期。
- Raw Protocol Capture 默认关闭、限时并明确风险。
- 用户可导出诊断 ZIP，预览后手动发送或附加 GitHub Issue。
- 禁止实现远程日志后门或静默上传。

## 二十三、开发阶段

严格按 `docs/06-development-plan.md`：

0. 工程核验与基础完善。
1. Provider 与纯净聊天 MVP。
   1.5 企业云与本地模型协议。
2. Desktop Agent 与内置工具。
3. 上下文压缩与记忆。
4. Skill 系统。
5. MCP Client。
6. 通用工具与浏览器自动化。
7. Computer Use。
8. 发布质量。

每阶段开始前输出目标、非目标、修改范围、风险和验收方式；完成后输出真实完成项、未完成项、测试/构建/性能结果和已知问题，然后停止。不得擅自 Push 或发布。

## 二十四、当前任务

当前只执行 **阶段 0：现有工程核验与基础完善**。

1. 检查仓库和全部文档实际内容。
2. 执行 `pnpm install` 并生成 `pnpm-lock.yaml`。
3. 运行 `pnpm typecheck`、`pnpm lint`、`pnpm test`、`pnpm build:web`。
4. 在当前平台核验 `pnpm dev:desktop` 与 `pnpm build:desktop`。
5. 修复真实的配置、依赖、类型、构建和 UI 基础问题。
6. 完善 Runtime/Capability、i18n、主题、Design Token、错误边界和 CI。
7. 核验 README 中文和英文内容、链接和当前状态描述准确。
8. 核验 `ProviderPreset`、`ProtocolAdapterId`、`ModelProfile` 类型、预设目录和 `officialLinks`；修复错误 Endpoint 或不准确声明，但不要实现完整 Provider。
9. 建立统一流式事件协议、Provider 错误类型和 Usage 事件骨架，不接入真实 API。
10. 确认 Ask/Plan/Agent 的 Capability/Tool Registry 设计可在后续代码层强制执行。
11. 核验 Skill/MCP 类型与 Web/Desktop 边界一致，但不要实现完整功能。
12. 建立 Personalization、Notification、Usage、Shortcut、Help、Feedback 和 ExternalLink 的类型/Port 骨架，确保 protected Prompt 不存在公共写入口。
13. 核验 GitHub Issue 模板和内置中英文帮助内容。
14. 建立 `ModelSwitchCoordinator`、`ModelHandoffCheckpoint`、Context Budget 和 File Reference 的类型/Port 骨架，但不要接入真实模型。
15. 建立统一 `LoggerPort`、LogEvent、Correlation ID、基础脱敏和诊断导出 Port 骨架；不得实现远程日志上传。
16. 建立 Harness Middleware 接口、循环检测与 Verification Port 骨架，并通过结构测试保护依赖方向。
17. 执行 bundle、启动、空闲内存/CPU 和基础日志开销的可行基线检查并记录。
18. 输出阶段 0 报告并停止。

不要提前实现完整聊天 Provider、Agent Loop、记忆、Skill、MCP、浏览器自动化或 Computer Use。
