# Evir 技术架构文档

## 1. 技术栈

- Desktop：Tauri 2 + Rust
- Frontend：React + TypeScript + Vite
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
- Secrets：系统 Keychain/Credential Manager
- Markdown：react-markdown + remark-gfm；Shiki 按需加载
- Test：Vitest + Testing Library + Playwright；Desktop 补充 Rust tests 和 Tauri E2E

## 2. 单仓库双产物

```text
pnpm build:web
  -> dist/              静态 Web 资源

pnpm build:desktop
  -> Tauri bundles      当前操作系统安装包
```

同一台本地机器上的普通构建命令只构建当前平台。正式发布由 GitHub Actions 矩阵完成：

- `macos-latest`：构建 `.app` / `.dmg`
- `windows-latest`：构建 `.exe` / `.msi`

一个 Git tag 可以触发两个 Runner，产物汇总到同一个 GitHub Release。

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

所有实现位于 Storage/Artifact Adapter 后，Domain 和 UI 不直接依赖 SQLite。

核心实体：

- providers
- conversations
- messages
- attachments
- agent_runs
- run_steps
- tool_executions
- approvals
- memories
- artifacts
- workspaces
- settings

本地 Schema 迁移必须版本化、可回滚或提供前向修复策略。详细数据模型、备份、崩溃恢复见 `docs/09-storage-artifacts-and-recovery.md`。

## 11. 发布架构

- Web：静态部署；可选独立、无状态、自托管 Proxy。
- Desktop：GitHub Actions 矩阵构建。
- macOS：签名与 notarization。
- Windows：代码签名。
- Updater：后续使用 Tauri Updater + 静态更新 JSON/GitHub Releases。

## 11.1 Skill 与 MCP 架构补充

```text
Skill Registry -> Skill Router -> Skill Loader -> Context Builder
MCP Client -> MCP Tool Adapter -> Tool Registry -> Permission Engine -> Agent Loop
```

Skill、MCP、内置工具必须共享统一 Capability、ToolDefinition、审批、审计、超时和取消协议。详细规范见 `docs/08-skill-and-mcp.md`。


## 12. 模型能力检测

Provider 连接成功不代表可运行 Agent。模型配置必须记录和展示：流式、Tool Calling、并行工具、图片、结构化输出、系统指令、上下文上限和用量返回能力。聊天模式可用但工具调用不可用时，必须禁用 Agent 模式并说明原因。

## 13. 运行模式与计划

Conversation、AgentRun、Plan、Step、ToolExecution 是独立实体。Ask 不自主访问本地资源；Plan 只注册授权范围内的只读工具；Agent 才注册写入和执行工具。复杂任务允许先生成 Plan 并由用户确认；模式由用户明确选择，不由模型隐式猜测。

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

Diagnostic、Audit、Crash 分开存储。`DiagnosticExportService` 生成脱敏 ZIP；Evir 不实现远程日志访问和静默上传。详细规范见 `docs/17-local-logging-and-diagnostics.md`。
