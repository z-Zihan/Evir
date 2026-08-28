# Evir 技术架构文档

## 1. 技术栈

- Desktop：Tauri 2 + Rust
- Frontend：React + TypeScript + Vite
- VS Code Extension：Extension Host + Webview + VS Code API + esbuild
- CLI：Node.js ESM + TypeScript + esbuild；系统凭据使用 `@napi-rs/keyring`
- Workspace：pnpm workspace
- UI：shadcn/ui 风格的源码组件 + Radix Primitives
- Styling：Tailwind CSS + CSS Variables
- Icons：Lucide
- State：Zustand
- Async state：TanStack Query（仅用于真正的异步服务状态）
- i18n：i18next + react-i18next
- Validation：Zod
- Web storage：IndexedDB（Dexie）
- Desktop structured storage：嵌入式 SQLite（默认 Adapter，无独立数据库服务）
- Secrets：本地加密 Vault（AES-256-GCM `secret-vault.json`；不使用 OS Keychain，见 docs/09 §2）
- Markdown：react-markdown + remark-gfm；Shiki 按需加载
- Test：Vitest + Testing Library + Playwright；Desktop 补充 Rust tests 和 Tauri E2E

## 2. 单仓库多产物

```text
pnpm build:web
  -> dist/web/          静态 Web 资源（10 个共享 Skill）

pnpm build:desktop:frontend
  -> dist/desktop/      Tauri 前端资源（共享 10 + Desktop-only 26）

pnpm build:desktop
  -> Tauri bundles      当前操作系统安装包

pnpm package:vscode
  -> extensions/vscode/artifacts/evir.vsix

pnpm build:cli
  -> packages/cli/dist/cli.js
```

同一台本地机器上的普通构建命令只构建当前平台。正式发布由 GitHub Actions 矩阵完成：

- `macos-latest` + `aarch64-apple-darwin`：构建 Apple Silicon `.app` / `.dmg`
- `macos-latest` + `x86_64-apple-darwin`：交叉构建 Intel `.app` / `.dmg`
- `windows-latest`：构建 `.exe` / `.msi`

一个 Git Tag 触发三个显式矩阵项，产物汇总到同一个 GitHub Release。macOS 产物和 Actions Artifact 名必须包含 `arm64` 或 `x64`；`bundle.targets = "all"` 只表示包类型，不表示 CPU 架构。当前选择分别发布两个 DMG，不生成体积更大的 Universal Binary。

### 2.1 四个产品面的代码与发布边界

```text
src/core/providers/*             Provider/Protocol 纯 TypeScript Core
        ├─ Web React Adapter
        ├─ Tauri Desktop Adapter
        ├─ extensions/vscode/*   Extension Host + Webview Adapter
        └─ packages/cli/*        Terminal + Node Runtime Adapter
```

- Web/Desktop 共用前端应用与 `EvirRuntime`；VS Code 与 CLI 是独立入口，不伪装成 React/Tauri Runtime。
- 四个产品面可以复用纯 TypeScript Provider Adapter、流式事件与经过边界审查的 Domain 类型，但不得复用带有 React、Dexie、Tauri 或 VS Code API 的具体 Adapter。
- VS Code Webview 只发送经过 Zod 校验的意图消息；Provider、SecretStorage、文件和进程操作全部留在 Extension Host。
- CLI 入口只负责参数、终端 IO 与退出码；Provider、工作区、审批和配置分别位于独立模块。
- 所有产品面遵守 `Types → Config → Repository → Service → Runtime → UI`，共享 Core 不能反向依赖任一宿主。
- 版本发布必须同步根应用、VS Code Manifest 与 CLI package 的 SemVer；产物可以独立安装，不能互相要求常驻进程。

## 3. 分层架构

```text
Presentation
  React UI / Router / View Models
        |
Application
  Chat / Agent Run / Approval / Settings Use Cases
        |
Domain
  Messages / Runs / Tools / Memory / Context / Policies
        |
Runtime Contracts
  Storage / Secrets / Files / Process / Browser / Computer
        |
Adapters
  Web Runtime                    Desktop Runtime
  IndexedDB / Browser APIs       Tauri Commands / SQLite / OS APIs
```

依赖规则：上层依赖接口，不直接依赖 Tauri API；`src-tauri` 不理解 React 页面。

## 4. Runtime 与 Capability

```ts
export type Capability =
  | "chat"
  | "attachments"
  | "filesystem"
  | "terminal"
  | "git"
  | "localMcp"
  | "browserAutomation"
  | "computerUse"
  | "backgroundTasks"
  | "systemNotifications"
  | "globalShortcuts";

export interface EvirRuntime {
  target: "web" | "desktop";
  capabilities: ReadonlySet<Capability>;
  storage: StoragePort;
  secrets: SecretStoragePort;
  tools: ToolRegistry;
}
```

工具必须根据 Capability 注册。Web 模型请求中不得出现不可用工具。

### 4.1 VS Code 与 CLI Capability Gate

VS Code 与 CLI 不扩展上述 `EvirRuntime.target` 联合类型，而是在各自宿主实现等价的 Capability Gate：

```text
VS Code Agent = toolCalling
              + workspace.isTrusted
              + local file workspace
              + workspace boundary validation

CLI Agent     = toolCalling
              + resolved absolute workspace
              + interactive approval for write/execute
```

VS Code Ask 不创建 `WorkspaceTools`；Agent 不满足任一条件时降级到 Ask 并给出具体原因。CLI Ask 不解析或注册工作区工具；Agent 的所有相对路径都必须在 realpath/symlink 检查后仍位于工作区。两者都使用 AbortSignal 取消 Provider 流和可终止子进程。

### 4.2 VS Code Extension 进程模型

```text
Webview (presentation only)
  → validated postMessage
EvirViewProvider / AgentRunner (application)
  → ProviderClient / ConversationStore / ChangeTracker (service/repository)
  → SecretStorage / globalState / workspace.fs / child_process (runtime adapters)
```

- Webview 启用 CSP nonce，不把 API Key、文件系统句柄或命令执行能力暴露给页面脚本。
- Extension Host 保存单一当前 Provider 配置和本地会话；密钥与非敏感配置分离。
- Agent Run 应产生统一运行事件：`run-start`、`step`、`tool-pending`、`approval`、`tool-result`、`verification`、`stopped`、`failed`、`completed`。Webview 只消费标准事件，不推断完成状态。
- 写入前创建快照；Diff 与回滚必须检测目标文件是否已被用户或其他扩展修改。
- Remote/WSL/Web 环境在首版明确拒绝，不以路径字符串猜测为本地工作区。

### 4.3 CLI 进程与 IO 模型

```text
argv / stdin
  → argument parser + command use case
  → provider/config/credential/agent services
  → filesystem/process/keyring adapters
  → stdout(result) + stderr(status/error/approval) + exit code
```

- 正常响应和机器可读结果写 stdout；提示、状态、审批和错误写 stderr，避免破坏管道。
- `SIGINT` 中止 Provider 请求和活动子进程并返回 `130`；输入/配置错误、连接错误和工具错误使用稳定、文档化的非零退出码。
- JSON/JSONL 输出必须有版本字段；流式文本与结构化事件不得混写。
- 非交互终端不得批准写入或命令。未来若增加自动化授权，必须通过显式策略文件或细粒度参数进入 Tool Policy，不能使用全局 `--yes` 绕过高风险操作。
- CLI 不在内存中长期保存完整工具输出；超限内容写临时 Artifact 并在 stderr 给出路径和摘要。

## 5. Agent Core

主要模块：

- `AgentRunner`：Agent Loop 与生命周期。
- `RunStateStore`：目标、步骤、状态、验证与错误。
- `ToolRegistry`：工具 Schema、执行器和能力要求。
- `ApprovalEngine`：风险分类和审批策略。
- `ContextBuilder`：构建每轮模型上下文。
- `ContextCompactor`：压缩历史和工具输出。
- `MemoryManager`：写入、检索、删除和过期策略。
- `CompletionVerifier`：基于证据判断是否完成。
- `ArtifactStore`：完整日志和大结果的本地归档。

## 6. 上下文系统

每轮上下文按固定顺序构建：

1. 系统与安全规则。
2. 当前目标和用户最新指令。
3. 当前运行状态摘要。
4. 检索到的相关长期记忆。
5. 最近未压缩对话。
6. 必要工具结果摘要。

预算策略：

- 为模型输出、系统指令和工具调用预留固定比例。
- 超预算时先移除低价值工具噪声，再摘要旧消息。
- 完整日志写入 ArtifactStore，不因压缩而丢失审计证据。
- 文件内容按需重读，不永久占用上下文。

## 7. 记忆系统

### 会话记忆

消息、附件、工具调用、运行记录。用于恢复会话。

### 工作记忆

当前任务目标、计划、完成步骤、待办、失败、变更文件和验证结果。任务结束后归档。

### 长期记忆

跨会话稳定事实和偏好。写入必须带来源、置信度、作用域和时间戳；支持用户查看、编辑、删除和关闭。

第一阶段使用 SQLite + FTS；向量检索作为后续可插拔能力。

## 8. Provider 与协议架构

```text
Provider Preset
  厂商、区域、默认 Endpoint、认证表单
        |
Protocol Adapter
  请求、流式、工具、错误、usage、opaque provider state
        |
Model Profile
  模型级能力、上下文、验证证据
```

核心接口：

```ts
export interface ProtocolAdapter {
  id: string;
  testConnection(config: ProviderConfig, signal: AbortSignal): Promise<ConnectionResult>;
  listModels?(config: ProviderConfig, signal: AbortSignal): Promise<ModelInfo[]>;
  stream(request: ModelRequest, signal: AbortSignal): AsyncIterable<ProviderStreamEvent>;
}
```

P0 协议：OpenAI Responses、OpenAI Chat Completions、Anthropic Messages、Gemini Interactions/GenerateContent，以及 OpenAI/Anthropic 兼容端点。

P1 协议：Azure OpenAI、AWS Bedrock Converse、Vertex Gemini、Ollama Native、Mistral Native、Cohere Chat v2。

Provider Preset 不得包含业务执行逻辑。国内、国际和本地厂商复用协议 Adapter，完整清单见 `docs/13-provider-and-protocol-matrix.md`。

内部统一流式事件至少包括：

- `response-start`
- `text-delta`
- `tool-call-start` / `tool-call-arguments-delta` / `tool-call-end`
- `usage`
- `provider-state`
- `response-complete`
- `error`

不得让 UI 直接处理厂商原始响应。`provider-state` 用于保存工具续轮所需的 reasoning/thinking 等厂商状态，只供 Adapter 使用，不直接展示。

能力检测分为 preset、metadata、probe 和 user override。产生费用的能力探测需要用户确认。

## 9. 工具协议

每个工具包含：

- 唯一名称与版本。
- Zod 输入 Schema。
- 所需 Capability。
- 风险等级。
- 超时、取消和最大输出限制。
- 执行器。
- 用户可读预览和审计摘要。

禁止把任意模型参数直接拼接成 Shell 字符串。命令工具优先使用程序 + 参数数组；确需 Shell 时必须明确标识和审批。

## 10. 数据存储

SQLite 是嵌入式库，不是后端服务。Desktop 进程直接读写应用数据目录里的单个或少量数据库文件，无监听端口、无单独账号、无常驻数据库进程。

分层原则：

- 系统安全存储：API Key、Token、敏感 Header。
- 轻量配置文件/Tauri Store：主题、语言、窗口和非敏感开关。
- SQLite：会话、消息、任务、工具记录、记忆、Skill/MCP 元数据、全文搜索索引。
- Artifact 文件目录：附件、超长日志、Diff、快照、生成文件和备份。
- 临时目录/内存：隐私会话和可丢弃中间结果。

### Desktop / CLI Provider 共享

Desktop 与 CLI 通过 Storage Adapter 共享一份 `version: 1` 的 `providers.json`。文件只保存 Provider ID、名称、协议、Base URL、模型、能力、默认项和时间戳；Schema 严格校验，最多 100 项，使用临时文件加原子替换写入，绝不包含 API Key。Desktop 写入时按 Provider ID 和 `updatedAt` 合并磁盘新值，显式删除使用独立 ID 列表，避免运行中的旧内存列表覆盖 CLI 刚写入的 Profile。

```text
Desktop Provider Store ─┐
                        ├─ providers.json（非敏感、版本化）
CLI Config Store ───────┘

Desktop Secure Store ──── secret-vault.json（AES-256-GCM，条目=provider:<id>:api-key）
CLI Credential Adapter ─ OS Credential Store   service=evir（CLI 面）
```

Desktop 的 `keychain_*` Tauri 命令由本地加密 Vault 支持，完全不触碰 OS Keychain：重建/重打包不会触发 macOS 钥匙串弹窗，也不会丢失已存 Key。

CLI 的凭据优先级为 `EVIR_API_KEY` → 系统安全凭据。Desktop 继续以 SQLite 保存完整结构化 Provider 记录，并在加载时按 `updatedAt` 合并共享 Profile；旧 CLI `config.json` 只读兼容，在下次 `configure` 时迁移。VS Code 扩展仍使用隔离的 SecretStorage，不读取这一桌面级共享文件。

共享 Profile 的技术契约、CLI 命令/退出码和迁移规则见 `docs/20-cli-product-and-technical-specification.md`。VS Code Host/Webview 消息、存储与工作区边界见 `docs/19-vscode-extension-and-editor-roadmap.md`。

所有实现位于 Storage/Artifact Adapter 后，Domain 和 UI 不直接依赖 SQLite。

核心实体：

- providers
- projects
- conversations
- messages
- attachments
- agent_runs
- task_briefs
- plans
- run_events
- agent_assignments
- run_steps
- tool_executions
- approvals
- memories
- skills
- mcp_servers
- usage_records
- artifacts
- settings

本地 Schema 迁移必须版本化、可回滚或提供前向修复策略。详细数据模型、备份、崩溃恢复见 `docs/09-storage-artifacts-and-recovery.md`。

## 11. 发布架构

- Web：静态部署；可选独立、无状态、自托管 Proxy。
- Desktop：GitHub Actions 矩阵构建。
- macOS：默认产出 ad-hoc 签名的可运行包（非签名包）；Developer ID 签名与 notarization 为可选增强，非发布必要项，配置证书密钥后自动启用。
- macOS CPU：分别构建 `aarch64-apple-darwin` 和 `x86_64-apple-darwin`；两者使用相同版本与打包门禁。
- Windows：默认非签名包；代码签名为可选增强，非发布必要项。
- Updater：后续使用 Tauri Updater + 静态更新 JSON/GitHub Releases。
- VS Code：生成 `evir.vsix`，分别在 VS Code Marketplace 与 Open VSX 做安装/升级/卸载验收；首版不自动发布。
- CLI：生成 npm tarball，验证 `bin`、生产依赖、macOS/Windows/Linux 凭据适配和全局/一次性执行；首版不自动发布 npm。
- Release Tag 仅接受 `v<MAJOR>.<MINOR>.<PATCH>`，且根应用、扩展和 CLI 版本必须一致。

## 11.1 Skill 与 MCP 架构补充

```text
Skill Registry -> Skill Router -> Skill Loader -> Context Builder
MCP Client -> MCP Tool Adapter -> Tool Registry -> Permission Engine -> Agent Loop
```

Skill、MCP、内置工具必须共享统一 Capability、ToolDefinition、审批、审计、超时和取消协议。详细规范见 `docs/08-skill-and-mcp.md`。

## 12. 模型能力检测

Provider 连接成功不代表可运行 Agent。模型配置必须记录和展示：流式、Tool Calling、并行工具、图片、结构化输出、系统指令、上下文上限和用量返回能力。聊天模式可用但工具调用不可用时，必须禁用 Agent 模式并说明原因。

## 13. 运行模式与计划

Conversation、AgentRun、Plan、Step、ToolExecution 是独立实体，Conversation 携带 `projectId` 归属（缺省即 Standalone Chat）。Ask 不自主访问本地资源且不注册本地工具；默认 Project Task 在模型支持 Tool Calling 时具备 Agent 工具能力，并由模型依据任务决定是否调用工具；Plan 与 Goal 是显式特殊模式（Plan 仅注册 L1 只读工具，完成后可 Execute Plan 转入 Agent；Goal 复用任务编排并以 doneWhen 条件判定完成）。Composer 不显示 Agent 选择器；无 Tool Calling 时 Project Task 降级为聊天语义且不注册项目工具。有效模式由会话归属、显式 Plan/Goal 选择与模型能力推导（Standalone/Web → 恒 Ask）。运行期工作目录由 `active-root` 单一真相解析（运行中 Run 绑定 originating root），权限由 Project 级 permission profile（ask/workspace/full）在 Tool Executor 层强制。

## 14. 网络与权限策略

网络策略必须区分读取互联网与向外发送本地内容。模型 API、网页读取、包管理器、Git Remote、远程 MCP 和文件上传分别控制。上传本地文件、代码、日志或环境信息属于高风险外发。

## 15. 性能架构

- 不在启动阶段扫描全部工作区、全文读取 Skill 或启动 MCP Server。
- Provider SDK、Shiki、文档解析器、Playwright Sidecar 和重型页面按需加载。
- 流式增量先进入独立 Buffer，再按 `requestAnimationFrame` 或 16-50ms 批量提交 UI。
- 超长工具输出边接收边写 Artifact 文件，仅保留窗口化尾部和摘要。
- SQLite/文件 IO 不阻塞 UI 主线程；检索、压缩和索引支持取消。
- 对长列表使用选择器、细粒度 Store 和虚拟化，避免 Token 到达时重渲染会话侧栏。
- 性能预算和验收工具见 `docs/10-streaming-and-performance.md`。

## 16. 个性化、通知、Usage 与基础设施

- `PersonalizationManager` 负责用户可编辑 Markdown、作用域、版本和 Prompt 合并；Protected Prompt 不通过公共写接口暴露。
- `NotificationPort` 抽象 Web Notification API 与 Tauri Notification Plugin；只有设置开启后才请求权限。
- `UsageRecorder` 消费统一 Provider `usage` 事件，批量写入 Storage Adapter；估算器必须声明 tokenizer 和证据。
- `ShortcutRegistry` 统一应用快捷键、冲突检测和可选 Desktop 全局快捷键，组件不得自行注册全局监听。
- `FeedbackService` 只构建并打开 GitHub Issue URL；诊断信息必须先脱敏和预览。
- `HelpRegistry` 提供内置中英文离线主题，设置页按路由懒加载。

Provider Preset 的 `officialLinks` 仅用于展示官网、控制台、文档和状态页，不参与 API 请求。详细规则见 `docs/14-personalization-notifications-usage-shortcuts-feedback-help.md`。

## 17. 模型切换与 Handoff

模型切换由 `ModelSwitchCoordinator` 管理，不允许 UI 直接替换当前模型 ID。Coordinator 依次检查：运行状态、目标凭据、协议、模型能力、附件兼容、上下文预算、Provider 数据去向和 opaque state 兼容性。

Agent 运行中只在 Step/Tool 安全边界切换。跨协议切换创建 `ModelHandoffCheckpoint`，旧 Provider 私有 reasoning/thinking state 不迁移。详细状态机见 `docs/15-final-experience-model-switching-and-context.md`。

## 18. Context Compaction 实现要求

`ContextBudgetManager` 基于具体模型的上下文上限，预留输出、Tool Schema、Provider State 和安全余量。Compactor 采用分层策略：工具输出归档、重复状态合并、旧对话摘要、强制 Checkpoint。文件正文通过 `FileContextReference` 按需重读。

压缩任务可取消，不在 Token 流期间持续执行；摘要和原始数据分开保存。默认使用当前模型完成必要语义摘要，不依赖第二模型。

## 19. Harness Middleware

Agent Core 应采用可组合 Middleware，而非单体循环：Input Normalization、Mode Policy、Capability Gate、Context Budget、Skill Routing、Tool Policy、Loop Detection、Checkpoint、Verification 和 Observability。

每层可独立测试和替换。Harness 规范见 `docs/16-harness-engineering-for-evir.md`，仓库根目录 `AGENTS.md` 是 Coding Agent 的高密度机器可读入口。

## 20. 全系统日志架构

所有模块依赖 `LoggerPort`，Desktop Adapter 异步写入本地 JSONL 滚动文件。日志事件通过 session/run/step/tool/request ID 关联。日志队列有界、批量 flush，低优先级日志可在压力下采样或丢弃，但 fatal/audit 不能静默丢失。

Diagnostic、Audit、Crash 分开存储。诊断 ZIP 导出已实现（Rust `diagnostics_export_zip` 命令打包 manifest + 脱敏元数据 + 本地 JSONL 日志，`DiagnosticExportPort` 的 Desktop 适配器负责保存对话框与元数据组装）；Evir 不实现远程日志访问和静默上传。详细规范与实现状态见 `docs/17-local-logging-and-diagnostics.md`。

## 21. 可组合组件运行时

Web/Desktop Runtime 使用可信内置 `ComponentRuntime` 组装工具与 Harness Middleware，并为工作流和受限 UI 贡献预留统一生命周期。组件通过 Manifest 声明目标宿主、依赖与贡献；`EffectScope` 记录幂等逆操作；`reconcile` 在配置或定义变化时只卸载受影响的依赖子图，并在激活失败时恢复旧组件图。`HarnessMiddlewareRegistry` 按固定顺序执行请求、上下文、工具调用与完成阶段，并拒绝重复注册和重复 `next()`。

Manifest 依赖只决定生命周期，不授予权限。Tool Policy 由宿主以 protected Middleware 注册；Tool Registry、Tool Executor、工作区校验、审批和 Tauri/Rust 权限仍是强制安全边界。当前只接受随 Evir 构建的 `builtin` 组件，不加载任意第三方 JavaScript。完整契约见 `docs/21-composable-component-runtime.md`。

## 22. 任务编排 Domain

`src/core/orchestration` 是不依赖 React、Provider SDK、Tauri 或数据库实现的独立 Domain，包含 Task Brief、PlanGraph、PlanValidator、GraphScheduler、AgentDispatcher、WorkflowRegistry、RunEventV1 和 Repository Port。

```text
TaskIntakeService → PlanGeneratorPort → PlanValidator
                 → OrchestrationRepository → GraphScheduler
                 → AgentDispatcher / built-in subgraph → Agent Loop
                 → verification evidence → RunEventV1 Presenter
```

- Provider Adapter 只通过结构化 Tool Calling 提供 Brief/DAG 候选；宿主 Schema、Capability、审批边界、无环和资源锁校验拥有最终决定权。
- Scheduler 控制 Provider 原生并行 Tool Calling 之上的实际并发，并把同一 AbortSignal 传播到 Worker、Provider 流、工具和子进程。
- 旧 Agent Loop 保留为非编排路径和兼容执行器；编排节点复用同一 Tool Registry、Harness、审批和验证边界。
- 六个内置子图由可信 Component Runtime 注册；组件依赖不授予工具或资源权限。
