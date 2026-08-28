# Evir 产品需求文档（PRD）

## 1. 产品定义

Evir 是一个纯净、本地优先、用户自带模型（BYOK）的 AI 客户端与通用桌面 Agent。

产品原则：

1. 无广告、无积分、无强制账号、无会员干扰。
2. 用户自行配置模型、API Key 与 Base URL。
3. Web 与 Desktop 来源于同一个代码库，核心体验一致。
4. 用户数据默认保存在本地；Evir 不建设强依赖的业务后端。
5. Desktop 的系统操作必须可见、可审批、可停止、可审计、可回滚。
6. 不伪装能力：Web 不展示无法执行的桌面工具。
7. 默认流式输出，用户应尽快看到首个可见结果，并可随时停止。
8. 轻量与性能属于产品功能，不允许用后台常驻进程和重量级依赖换取开发便利。

## 2. 产品形态

### 2.1 Evir Web

定位：纯净的多模型 AI 聊天工具。

核心能力：

- 自定义 Provider、Base URL、API Key、模型名称。
- 默认流式对话、中止生成、重新生成、编辑后重发；流式中断时保留已生成内容并允许继续。
- Markdown、代码块、高亮、复制、附件上传。
- 多会话、本地搜索、导入与导出。
- System Prompt、温度、最大输出等高级配置。
- 多语言、亮色/暗色/跟随系统主题。
- 浏览器本地保存；默认不永久保存 API Key。

限制：

- 不执行 Shell、Git、系统命令。
- 不访问任意本地目录。
- 不控制鼠标、键盘和桌面应用。
- 浏览器直连 API 受目标服务 CORS 限制。

### 2.2 Evir Desktop

定位：具备本地执行能力的通用 AI Agent。

在 Web 能力基础上增加：

- 工作区与文件系统访问。
- 文件创建、读取、修改、移动、删除与检索。
- Shell/PTY、进程启动、中止与状态查看。
- Git 状态、Diff 与可控写操作。
- 本地 MCP Server 与 Skills。
- 浏览器自动化和 Computer Use（分阶段交付）。
- 分层本地存储：嵌入式 SQLite、系统安全凭据存储与本地 Artifact 文件；不需要数据库服务器。
- Agent Loop、任务计划、任务状态、错误恢复。
- 上下文预算、压缩、工具结果归档。
- 会话记忆、工作记忆、长期记忆。
- 权限审批、操作审计、快照与回滚。

### 2.3 Evir for VS Code

定位：在编辑器内完成代码问答与受控工作区任务的独立 BYOM 扩展，产品名固定为 **Evir**。

核心能力：

- 独立配置 Provider、Base URL、模型和 API Key；不要求安装或启动 Evir Desktop。
- Ask 只处理用户输入与主动提供的编辑器上下文，不自主读取工作区。
- Agent 仅在模型支持 Tool Calling、Workspace Trust 已授予且工作区为本地 `file` 类型时可用。
- 文件读取、搜索、写入、Git 状态/Diff 与受控命令；写入和命令逐次审批。
- 流式输出、停止、会话本地保存、最后一次写入 Diff 与冲突感知回滚。
- API Key 只进入 VS Code SecretStorage；配置和会话进入 Extension Storage。

首版限制：

- 不支持 VS Code Web、Remote SSH、Dev Container、WSL、Inline Completion、MCP、Skill 或 Desktop 会话同步。
- 不把“用户勾选支持 Tool Calling”描述为已验证能力；能力来源必须明确为用户声明或实际探测。
- Agent 运行必须展示步骤、工具、审批、错误、停止与验证证据；当前实现尚未完整呈现这些运行状态，属于发布前产品缺口。

完整规格见 `docs/19-vscode-extension-and-editor-roadmap.md`。

### 2.4 Evir CLI

定位：面向终端用户、脚本和自动化环境的独立 `evir` 命令行入口。

核心能力：

- `evir configure` 配置 Provider；API Key 写入系统安全凭据库。
- `evir doctor` 检查配置、凭据和 Provider 连接。
- `evir ask` 从参数或 stdin 接收 Prompt，并把模型文本流写到 stdout。
- `evir agent --workspace <path>` 在解析后的工作区边界内执行只读、写入和命令工具。
- 写入与命令默认拒绝，只有交互式终端中的逐次审批可以放行；非交互执行不得绕过审批。
- 与 Desktop 共享版本化的非敏感 Provider Profile 和系统凭据，但不依赖 Desktop 进程。

CLI 的用户界面契约包括稳定的 stdout/stderr 分工、退出码、Ctrl+C 取消、错误恢复指引、无颜色环境兼容和可选机器可读输出。当前首版已实现基础文本流、取消和安全审批；中英文、友好配置向导、结构化运行事件和 JSON 输出仍是发布前缺口，不得在文档中写成已完成。

完整规格见 `docs/20-cli-product-and-technical-specification.md`。

## 3. 目标用户

- 希望自带模型、避免平台积分与订阅干扰的用户。
- 开发者、设计师、运营、研究人员与知识工作者。
- 重视本地数据、透明权限和模型自由选择的用户。

## 4. 核心用户流程

### 4.1 首次启动

1. 选择界面语言和主题。
2. 选择国内、国际、本地或自定义 Provider；Preset 自动给出推荐协议、区域和 Endpoint。
3. 输入认证信息，获取模型列表；获取失败时允许手动填写模型 ID。
4. 执行连接、真实流式和可选能力测试，并展示能力来源与是否验证。
5. CORS、认证、模型、协议和限流错误必须分别展示合法下一步。
6. Web 进入聊天；Desktop 仅在用户首次使用相关能力时渐进申请工作区、辅助功能或屏幕录制权限。

### 4.2 Web 对话闭环

1. 创建会话。
2. 输入文本或添加附件。
3. 选择模型并发送。
4. 流式展示响应。
5. 支持停止、重试、复制、编辑、分支。
6. 自动保存到浏览器本地。
7. 支持搜索、导出和删除。

### 4.3 Desktop Agent 任务闭环

1. 用户输入目标并选择允许访问的工作区。
2. Agent 创建简短、可更新的执行计划。
3. Runtime 根据能力注册可用工具。
4. 每次工具执行前进行风险评估。
5. 需要审批时暂停并展示工具、参数、目录和风险。
6. 执行结果写入审计记录；超长结果存档并压缩。
7. Agent 根据结果继续、重试或调整计划。
8. 使用构建、测试、文件状态或其他验证器确认结果。
9. 输出完成摘要、变更清单、验证结果和遗留问题。
10. 用户可撤销任务产生的文件变更。

### 4.4 VS Code 首次成功任务

1. 安装 VSIX 并从 Activity Bar 打开 Evir。
2. 配置 Provider、模型和密钥，执行连接测试并保存。
3. 在 Ask 中完成一次流式问答；停止后保留已生成内容。
4. 用户主动信任本地工作区后选择 Agent；界面明确工作区内容将发送到当前 Provider。
5. Agent 展示当前步骤和工具状态；写入或命令出现逐次审批。
6. 完成后展示变更、验证证据和未完成项；用户可打开 Diff 或回滚最后一次写入。

失败分支必须覆盖：未配置、密钥缺失、连接失败、模型不支持工具、未信任工作区、远程工作区、审批拒绝、命令失败、停止、循环上限和回滚冲突。

### 4.5 CLI 首次成功任务

1. 运行 `evir configure`，完成必填参数与隐藏密钥输入。
2. 运行 `evir doctor`，获得配置、凭据和连接结果以及可执行的修复指引。
3. 运行 `evir ask "..."` 或通过 stdin 输入 Prompt，正文只写 stdout。
4. 运行 `evir agent "..." --workspace <path>`，先看到工作区与 Provider 数据去向。
5. 只读工具自动执行；每次写入和命令在 stderr 展示预览并默认拒绝。
6. Ctrl+C 终止当前请求和子进程，返回稳定退出码；任务结束输出摘要、验证和遗留问题。

非交互环境默认只允许 Ask 和只读 Agent；若未来支持自动批准，必须是显式、细粒度且不能覆盖删除、发布、上传、提权或工作区外访问。

## 5. 功能模块

- Chat：会话、消息、附件、稳定的流式响应与中断恢复。
- Providers：国内外 Provider Preset、协议选择、区域/站点、模型发现、能力检测、连接测试和用量。
- Agent：运行状态、计划、工具调用、终止与恢复。
- Workspace：目录授权、最近项目、文件变化。
- Tools：文件、终端、Git、浏览器、Computer、MCP。
- Memory：会话、工作、长期记忆及用户管理。
- Approvals：权限策略、单次/会话允许、拒绝。
- Settings：语言、主题、密钥、存储、隐私、更新。
- Diagnostics：日志导出、环境检查、故障报告。
- Artifacts：文件、Diff、日志、表格、图片、归档等任务产物。
- Modes：内部运行语义包括 Ask、Plan、Goal、Agent；Project Thread 默认任务在模型支持 Tool Calling 时使用 Agent 工具能力，Composer 仅把 Plan/Goal 暴露为显式特殊模式；Standalone Chat 恒为 Ask。工具集合由有效模式、模型能力和权限共同决定。
- Backup：会话、Skill、MCP 配置和设置的导入导出与恢复。

## 6. 多语言要求

首发语言：

- `zh-CN` 简体中文
- `en` English

架构必须天然支持增加 `ja`、`ko`、`es`、`pt-BR`、`ru`、`ar` 等语言。

规则：

- UI 文案不得硬编码。
- 使用命名空间组织翻译资源。
- 支持复数、插值、日期和数字本地化。
- 布局不得依赖中文字符长度。
- 组件必须允许文本增长 30%-50%。
- 从架构层预留 RTL，不承诺首发完整 RTL。

## 7. 主题要求

首发支持：

- 亮色
- 暗色
- 跟随系统

使用语义化 Design Token，不允许业务组件直接写死大面积颜色。主题状态在 Web 保存到浏览器，在 Desktop 保存到本地配置，并监听系统主题变化。

## 8. 数据与隐私

- 默认无账号。
- “数据库”仅指用户电脑上的嵌入式本地数据文件，不是云端数据库，不监听端口，也不要求单独安装和启动服务。
- Web 会话使用 IndexedDB；Desktop 默认使用 SQLite Adapter 保存结构化数据。
- 简单设置可使用轻量配置文件；API Key 使用系统安全凭据库；大附件、完整日志、Diff 和快照进入本地 Artifact 目录。
- Storage Port 必须允许未来更换实现，UI 和 Agent Core 不得直接依赖 SQLite。
- 临时会话/隐私模式下，不持久化消息和长期记忆，仅使用内存与临时目录。
- Web API Key 默认仅保存在内存，用户可明确选择本地保存。
- Desktop API Key 存系统安全凭据库。
- 不默认上传会话、文件内容和工具日志。
- 日志导出前进行密钥和常见敏感字段脱敏。
- 删除会话、记忆、Provider 后必须可验证地清理本地数据。

## 9. 非功能要求

### 9.1 流式体验

- 所有支持流式的 Provider 默认启用流式输出。
- Provider 首个事件到达后，目标在 100ms 内呈现首个可见增量。
- UI 使用批量刷新，不得因每个 Token 触发整棵消息树重渲染。
- 支持停止、网络中断、部分内容保留、错误提示和重新继续。
- 工具调用、状态摘要和长日志也应增量展示，但不得暴露模型私有推理链。

### 9.2 性能与轻量

- Web 首屏可用，关键操作有加载、空态、错误态。
- Desktop 不启动不必要的后台服务；空闲状态不持续轮询。
- Node/Playwright 等 Sidecar 仅在相关能力被启用时按需启动。
- 初始路由、Shiki、Skill 正文、MCP 能力和长会话列表按需加载。
- 长会话、工具记录和文件列表达到阈值后使用虚拟列表。
- 完整工具输出超过阈值后直接流入 Artifact 文件，不长期驻留内存。
- 性能指标与测试基线见 `docs/10-streaming-and-performance.md`。
- Desktop 任意长任务可暂停或中止。
- Agent 不得静默执行高风险命令。
- 单个工具失败不得导致整个应用崩溃。
- 支持键盘操作与基础可访问性。
- macOS 和 Windows 使用各自 Runner 构建与测试。

## 10. MVP 验收标准

### Web MVP

- 可配置至少一种 OpenAI-compatible Provider。
- 可完成流式多轮聊天。
- 支持中英文、三种主题、会话本地保存。
- 构建产物可部署到静态服务器。

### Desktop MVP

- macOS Apple Silicon（arm64）、macOS Intel（x64）和 Windows x64 均有架构明确的安装包并可安装启动；不得依赖 `macos-latest` 的隐式主机架构。
- 具备 Web 全部功能。
- 可授权工作区、读取/写入文件、执行受控命令。
- 有审批、审计、停止、任务摘要和文件回滚。
- 有基础上下文压缩和三层记忆模型。
- 达到流式响应、启动、内存、空闲 CPU、包体积和长列表性能门槛。

### VS Code Extension MVP

- VSIX 可在受支持的 VS Code Desktop 版本安装、激活、卸载和升级。
- 可独立配置至少一种 OpenAI-compatible Provider，完成流式 Ask 与停止。
- 在受信任本地工作区完成“读取 → 修改 → 审批 → 验证 → Diff/回滚”闭环。
- Light/Dark、中文/英文、窄侧栏、键盘焦点和屏幕阅读器名称通过真实 Extension Host 验收。
- 未信任、远程工作区、无 Tool Calling、无密钥和连接失败均有明确下一步。
- 发布包不包含测试工作区、临时凭据、开发版 VS Code 或未声明遥测。

### CLI MVP

- macOS、Windows 和 Linux 安装后可运行 `evir --version`、`configure`、`doctor`、`ask` 和 `agent`。
- stdout 只承载正常结果，诊断/审批写 stderr；退出码和 SIGINT 语义有文档与测试。
- `ask` 支持参数与 stdin；`agent` 强制真实工作区边界和写入/命令审批。
- 配置损坏、缺少凭据、协议错误、连接错误、非交互审批和工具失败提供可执行下一步，不泄露密钥。
- 人类输出支持中英文；自动化可请求稳定版本的 JSON/JSONL 事件且不与流式文本混杂。
- npm tarball 只包含生产 Bundle、README 和许可证；CLI 不要求 Desktop 常驻进程。

## 10.1 Skill 与 MCP 产品闭环

### Skill

用户可浏览内置 Skill，启用或禁用；可从本地目录/ZIP 导入；可通过表单或对话创建、预览、测试、安装、编辑、导出和卸载。Skill 自动路由可关闭，用户也可在每个任务中显式选择。Web 仅支持不依赖本地工具、脚本和 MCP 的指令型 Skill；Desktop 支持完整 Skill。能力不兼容时必须阻止安装或只读预览，不能静默降级。

### MCP

Evir Desktop 支持本地 stdio 与远程 Streamable HTTP MCP；新增 Server 默认禁用，用户查看能力并授权后才能使用。Evir Web 第一版不支持 MCP。Evir 不提供或依赖云端业务后端。

## 11. 模式、权限与数据恢复闭环

### Ask / Plan / Goal / Agent

- Ask：只基于用户输入和主动添加的附件回答；不自主读取工作区或执行本地工具。
- Plan：Project Thread 一等模式。可在项目范围内使用只读工具（L1）检查文件和 Git 状态，产出结构化计划和风险；不写文件、不安装依赖、不执行改变系统状态的命令；完成后可一键 Execute Plan 转入 Agent。
- Goal：Project Thread 一等模式。面向长期目标，输入支持 Objective + doneWhen 完成条件；复用任务编排全链路（预算护栏、暂停/恢复、目标横幅），完成判定必须来自条件证据而非模型文字。
- Agent：按权限策略执行读写工具和命令。

模式切换必须重新计算 Tool Registry，禁止只依赖提示词约束。

### 权限预设（Project 级）

权限按 Project 配置，三档 profile：

- ask（默认）：项目内写操作与命令逐次审批；只读操作自动。
- workspace：项目内读写与命令自动放行（记录 permission.auto-approved 审计）；additional roots 之外仍需审批。
- full：解除路径边界；首次开启必须通过明确确认对话框，绝不默认。

Project 还可声明 Additional Access Roots（额外授权目录），边界校验在 Tool Executor 与 Rust 侧双层强制。

### 备份与恢复

- 支持导出会话、Skill、MCP 配置、设置和任务产物索引。
- API Key 默认不导出；敏感数据只有用户主动选择并设置密码后才允许加密导出。
- 应用异常退出后可发现未完成任务，但不得自动重放危险操作。

## 12. Provider 与协议产品要求

- Provider、Protocol 和 Model Capability 必须分层，不能用厂商名称硬编码请求逻辑。
- 首批 Provider 必须覆盖国内、国际、本地与自定义端点，清单见 `docs/13-provider-and-protocol-matrix.md`。
- 首批协议至少支持 OpenAI Responses、OpenAI Chat Completions、Anthropic Messages、Gemini Interactions/GenerateContent 及相应兼容协议。
- Azure OpenAI、AWS Bedrock、Vertex AI、Ollama Native、Mistral Native 和 Cohere Chat v2 按开发计划进入企业/本地阶段。
- 能力是模型级数据，记录 preset、metadata、probe 或 user override 证据。未经验证的能力不得显示为确定支持。
- 能力探测可能产生费用时必须提前确认；不得为了探测启用服务端搜索、代码执行或远程 MCP。
- 默认不自动跨 Provider 回退，避免成本和数据去向失控。
- Provider 服务端工具与 Evir Local Tool、MCP Tool 分开展示和审计。
- Desktop 与 CLI 在同一设备共享版本化的非敏感 Provider Profile 和系统安全凭据；API Key 不得进入 JSON、命令输出或日志。
- CLI 不依赖 Desktop 安装或常驻进程。`evir configure` 必须能独立创建 Provider 与安全凭据；Desktop 在下次加载 Provider 时识别该配置。
- `EVIR_API_KEY` 仅作为当前 CLI 进程的最高优先级覆盖。共享配置损坏或版本不支持时必须明确报错，不得静默覆盖。

## 13. 完成、退出与系统权限闭环

- Desktop 采用渐进权限，只在用户首次使用相关能力时申请。拒绝权限不得阻止普通聊天。
- 停止生成只取消模型流；停止任务同时终止可取消工具和子进程。
- 应用退出时如有运行任务，必须让用户选择暂停并退出、停止并退出或返回。
- 完成页展示目标、变更、命令、审批、验证证据、Artifact、未完成项和回滚入口。
- 异常恢复不得自动重放写操作、支付、发布、上传或其他危险行为。

## 14. 产品闭环验收

任何新功能必须同时具备入口、正常流程、加载/空/错误/禁用状态、失败后的下一步、保存和删除规则、取消能力、风险审批、结果验证、多语言、多主题和性能预算。详细审查见 `docs/12-product-closure-review.md`。

## 15. 个性化与基础产品控制

Evir 支持简单表单和高级 Markdown 两种个性化方式。用户可编辑 `USER.md`、`PERSONA.md`、`INSTRUCTIONS.md` 和可选 `SOUL.md`，但不能编辑或覆盖 Evir 核心安全、权限、工具与网络规则。

设置页增加通知、快捷键、用量统计、帮助、反馈和关于模块。系统通知由用户主动开启；Token 统计区分 Provider 准确值、估算值和不可用；全局快捷键默认关闭；反馈通过浏览器打开 GitHub Issue，不要求 Evir 后端或 GitHub Token。完整规范见 `docs/14-personalization-notifications-usage-shortcuts-feedback-help.md`。

## 16. 最终核心体验与单模型启动

- Evir Desktop 的默认承诺是：接入一个支持 Tool Calling 的模型，即可开始 Agent 任务。
- 不强制配置第二模型、Embedding、Skill、MCP、长期记忆、通知或全局快捷键。
- 首次配置完成后直接进入主界面；文件、辅助功能、屏幕录制等权限只在首次使用相关能力时申请。
- 主界面只突出模型、模式、输入、发送/停止和当前任务状态；高级配置统一进入设置或命令面板。
- 不支持 Tool Calling 的模型仍可使用 Ask，但不得伪装为可操作电脑。

## 17. 模型中途切换产品要求

- 空闲状态可立即切换。
- 流式生成中默认下一轮生效，也允许用户停止后立即切换。
- 工具执行中不得静默切换；必须等到安全检查点或终止工具。
- Agent 任务切换前生成结构化 Handoff，保留目标、用户约束、已完成步骤、审批、文件变更、验证和未解决错误。
- 跨 Provider 切换必须明确新的数据去向；默认不自动跨 Provider 回退。
- 目标模型能力不足时阻止切换或要求用户确认降级到 Ask/Plan。
- 目标上下文更小时先压缩；仍超限则提供新建分支、移除附件或缩小历史。

## 18. 上下文压缩产品要求

- 上下文压缩由本地 Harness 管理，不要求第二个模型。
- 优先归档工具噪声和可重读文件，再摘要旧对话。
- 当前用户要求、权限、任务状态、错误、变更和验证证据不得因压缩丢失。
- 摘要结构化、版本化，并可从本地原始记录重新生成，禁止无限摘要的摘要。
- 模型切换时根据目标模型上下文重新预算和压缩。

## 19. 本地全系统日志

- Provider、Streaming、Agent、Context、Memory、Tool、Approval、MCP、Skill、Storage、Performance 和 Crash 使用统一 LoggerPort。
- 日志、审计和崩溃报告分离；日志默认本地、脱敏、滚动保存。
- 不存在可远程读取日志的后门。高级诊断入口只解锁本地选项，不能绕过用户授权。
- 用户可生成诊断 ZIP（已实现：manifest + 脱敏元数据 + 本地 JSONL 日志；导出前预览文件数与体积），发送给他人或手动附加到 GitHub Issue。
- API Key、Authorization、完整会话和文件正文默认不得进入日志或诊断包。
- 完整规则见 `docs/17-local-logging-and-diagnostics.md`。

## 20. 当前已验证产品边界（2026-08-27 信息架构）

- Web 当前只承诺聊天与附件分析，不展示 Project、Agent、Plan、Goal、本地工作区、文件/终端/Git 工具或 MCP。
- Desktop 侧栏为 PROJECTS / CHATS 两区：Project 是一等实体（UUID 身份、realpath 去重、重绑保 ID），决定工作目录；Standalone Chat 只是聊天。
- Composer 在 Project Thread 内默认执行普通 Project Task，仅提供 Plan / Goal 两个可切换的特殊模式与项目权限档位，不显示 Agent 选择器；Standalone Chat 恒为 Ask 且不出现模式控件。无 Tool Calling 时 Project 仍可聊天，但不开放项目工具并引导换模型。
- 工作目录只来自 Sidebar 的 Project，不存在输入区工作区选择器；运行中的 Agent Run 绑定 originating root，切换项目不污染活动 Run。
- 同一 Agent Run 的工具调用在一个 Agent Activity 内分组；审批、失败、停止和完成使用统一状态表达。
- 上述边界已有 Web/Desktop Capability 自动化证据。真实 Provider 和原生工作区完整 Agent 任务已实现并完成实机验收（见记忆 Update Log 2026-08-26/27）。

## 21. 智能任务理解与编排

- Desktop Agent 在发送后立即进入任务理解状态，形成版本化 Task Brief；只对范围、权限、数据去向、成本和验收的阻塞未知项提问，每轮最多 3 项、最多两轮。
- Planner 优先通过 Provider Tool Calling 生成结构化 DAG；Schema 或机械校验失败时回退到内置确定性计划，不从正文截取 JSON，也不让意图识别切换模式或扩大权限。
- DAG 由宿主 Scheduler 执行。默认最多两个 Worker；只读或资源范围明确不相交的节点才并行，未知写范围、同一工作区和共享外部资源自动串行。
- 管理 Agent 保持用户对话控制。子 Agent 只能使用同一 Provider/Model、父任务工具和权限的子集、最小上下文与 12 轮预算，不能递归派发。
- 澄清、计划确认、节点、Worker、工具、验证、暂停、恢复和终态通过 `RunEventV1` 表达；UI 不从模型文字推断运行状态。
- 完成必须有工具或验证器产生的可观察证据。崩溃恢复只恢复事件和检查点，不自动重放写入、命令、外发或高风险操作。
