# Evir 最终体验、模型切换与上下文策略

## 1. 最终产品目标

Evir 的最高优先级不是功能数量，而是以下四项：

1. 操作简单、方便、快捷。
2. 性能卓越、响应快、长期运行稳定。
3. 界面干净、清爽、交互合理，主流程不复杂。
4. 小而美：用户只需接入一个**支持工具调用的模型**，即可开始使用 Desktop Agent；不强制配置第二个模型、Embedding 服务、MCP、Skill 或 Evir 云端后端。

任何新功能若破坏以上目标，应默认隐藏在高级设置、命令面板或按需入口中，而不是进入主操作路径。

## 2. 最短成功路径

### 2.1 Desktop 首次使用

```text
启动 Evir
→ 选择模型供应商
→ 输入 API Key / Endpoint
→ 选择或填写模型
→ 自动进行最小连接与流式检测
→ 进入主界面
→ 输入任务
→ 首次需要时选择工作区并授予对应系统权限
→ Agent 开始工作
```

首次成功路径不得强制用户配置：

- 账号或手机号。
- 第二个“总结模型”或“Embedding 模型”。
- Skill。
- MCP。
- 长期记忆。
- Token 价格。
- 系统通知。
- 全局快捷键。
- 浏览器自动化或 Computer Use 权限。

### 2.2 模型能力边界

- 支持普通文本生成：可用 Ask。
- 支持流式输出：获得完整默认体验；不支持时允许非流式，但清楚标识。
- 支持原生 Tool Calling：可用 Plan 和 Agent。
- 不支持 Tool Calling：默认禁用 Agent，并说明原因。
- 实验性的“提示词模拟工具调用”只能作为明确标记的兼容模式，不进入默认承诺，因为可靠性和安全性明显低于原生 Tool Calling。

产品文案应写为：

> 接入一个支持工具调用的大模型，即可开始使用 Evir Desktop Agent。

而不是无条件承诺“任何聊天模型都能操作电脑”。

### 2.3 VS Code 与 CLI 最短路径

- VS Code：安装 → 打开 Evir → 配置/测试 Provider → Ask；只有用户选择 Agent 时才要求本地 Workspace、Trust 和 Tool Calling。
- CLI：安装 → `evir configure` → `evir doctor` → `evir ask`；只有 `evir agent` 才解析工作区并请求写入/命令审批。
- 两者都不要求 Desktop、账号、Skill、MCP、Embedding 或第二模型。
- VS Code 不共享 Desktop/CLI 密钥；CLI 可共享非敏感 Profile/OS Credential，但 Desktop 不存在时仍能独立配置。
- 当前扩展/CLI 尚未实现完整模型中途切换 Coordinator；首版切换 Provider/模型不得在活动 Tool 链中静默发生。

## 3. 主界面复杂度控制

主界面默认只突出：

1. 当前会话。
2. 当前模型。
3. Ask / Plan / Agent 模式。
4. 输入与附件。
5. 发送 / 停止。
6. 当前任务状态与必要审批。

以下能力不应长期占据主界面：

- Provider 高级参数。
- Skill 管理。
- MCP 管理。
- 用量统计。
- 个性化 Markdown。
- 日志与诊断。
- 快捷键设置。
- 帮助与反馈。

这些能力统一放入设置、命令面板或上下文菜单。只有在任务实际使用时，Skill、MCP、工具和权限才以紧凑的状态条或执行时间线出现。

## 4. 模型中途切换原则

模型切换不是单纯替换一个 `model` 字段。Evir 必须处理协议、上下文上限、工具能力、附件能力、Provider 私有状态、数据去向和任务安全检查点。

### 4.1 切换状态机

```text
idle
→ validating-target-model
→ checking-capabilities
→ checking-context-budget
→ creating-handoff-checkpoint
→ switched

异常时：
→ blocked / requires-confirmation / rollback-to-previous-model
```

### 4.2 场景与默认行为

| 场景                             | 默认行为                                               |
| -------------------------------- | ------------------------------------------------------ |
| 未发送消息时切换                 | 立即切换                                               |
| 正在文本流式输出                 | 默认让当前响应完成；用户也可停止后立即切换             |
| 模型已发出工具调用但尚未执行     | 暂停，确认是否取消该调用后切换                         |
| 工具正在执行                     | 等待安全检查点或用户停止工具；不得在执行中静默替换模型 |
| 工具已完成、等待下一轮模型判断   | 生成 Handoff Checkpoint 后切换                         |
| Agent 长任务进行中               | 暂停到步骤边界，展示目标模型能力差异并确认             |
| 同 Provider、同协议切换          | 可复用标准化消息，但仍检查能力与上下文                 |
| 跨 Provider 切换                 | 明确提示后续数据将发送到新的服务商                     |
| 目标模型不支持 Tool Calling      | 阻止继续 Agent；可选择切到 Ask 或返回原模型            |
| 目标模型上下文更小               | 先压缩；仍超限则要求新建分支、移除附件或缩小历史       |
| 目标模型不支持当前附件类型       | 阻止发送并列出不兼容附件                               |
| 目标模型不支持当前 Provider Tool | 关闭对应服务端工具，不能伪装为可用                     |

### 4.3 Handoff Checkpoint

Agent 任务切换模型前，Evir 创建模型无关的结构化交接包：

```ts
interface ModelHandoffCheckpoint {
  objective: string;
  mode: "ask" | "plan" | "agent";
  completedSteps: string[];
  currentStep?: string;
  pendingSteps: string[];
  userConstraints: string[];
  approvals: string[];
  changedArtifacts: string[];
  verificationEvidence: string[];
  unresolvedErrors: string[];
  relevantMemoryIds: string[];
  contextSummaryVersion: string;
}
```

必须保留：

- 用户明确要求与禁止项。
- 当前权限和审批状态。
- 已执行工具及结果摘要。
- 文件变更和验证证据。
- 未解决错误。

不得跨 Provider 搬运：

- 厂商私有 reasoning / thinking 明文。
- 无法解释的 Provider 内部状态。
- 上一 Provider 的临时服务端工具句柄。

需要续轮的 opaque provider state 仅在同一兼容 Adapter 和同一会话链内复用；跨协议切换时必须结束旧链并使用结构化 Handoff 重建上下文。

### 4.4 数据与用量

- 切换记录写入本地运行事件。
- 切换前后 Token 与费用分别归属各自 Provider / Model。
- 默认不自动回退到另一个 Provider。
- 若未来支持自动回退，必须由用户显式配置候选模型、顺序和数据去向。

## 5. 上下文压缩原则

上下文压缩的目标是：**保留任务正确性，减少噪声和成本，而不是单纯把文字变短。**

### 5.1 单模型即可完成

Evir 不要求用户额外配置“压缩模型”。默认使用当前模型执行必要的摘要；结构化裁剪、日志归档、文件按需读取和 Token 预算由本地 Harness 完成。

未来可允许用户选择独立 Utility Model，但它必须是可选优化，不能成为正常运行前提。

### 5.2 Token 预算

每轮请求必须预留：

- 核心安全与模式规则。
- Tool Schema。
- 最大输出预算。
- 工具调用与 Provider 状态余量。
- 10%-15% 安全余量，防止厂商 Token 计算差异。

建议阈值：

- `< 60%`：不主动摘要，仅裁剪明显噪声。
- `60%-75%`：归档超长工具输出，合并重复状态。
- `75%-90%`：压缩较旧对话，保留最近原文和结构化任务状态。
- `> 90%`：创建强制检查点；按价值裁剪并重新检索必要内容。

阈值必须根据具体模型上下文动态计算，不写死为固定 Token 数。

### 5.3 永远优先保留

- 当前用户消息。
- 用户长期约束和本任务禁止项。
- 当前目标、步骤和未完成事项。
- 权限与审批状态。
- 最近失败及其错误码。
- 仍在使用的 Tool Call ID 与必要 Provider State。
- 关键文件路径、版本/hash、修改摘要。
- 验证结果与回滚信息。

### 5.4 可压缩或按需重读

- 很久以前的闲聊。
- 已归档的完整终端日志。
- 已读取但当前不相关的文件正文。
- 重复工具状态。
- 已完成且无争议的中间推导。
- 可从 Artifact 或文件系统重新获取的数据。

### 5.5 文件上下文

文件正文不长期复制进摘要。保存引用信息：

```ts
interface FileContextReference {
  path: string;
  contentHash?: string;
  lastReadAt: number;
  relevantRanges?: Array<{ startLine: number; endLine: number }>;
  summary: string;
  stale: boolean;
}
```

文件发生变化后标记 `stale`，需要时重新读取，避免模型基于旧代码继续工作。

### 5.6 摘要质量与恢复

- 摘要必须结构化、版本化并记录来源消息范围。
- 旧摘要不能无限“摘要的摘要”；达到层级上限后从原始本地记录重新生成。
- 用户可查看任务摘要，但不展示模型私有推理链。
- 压缩失败不得丢弃原始本地数据；原始消息和日志仍保存在本地存储/Artifact 中。

## 6. 性能与稳定性最终要求

### 6.1 性能

- 接入模型后的主流程不等待 Skill、MCP 或全量日志初始化。
- 启动阶段只加载设置、Provider 索引和最近会话摘要。
- MCP、Sidecar、文档解析、代码高亮和 Computer Use 按需加载。
- 日志采用异步有界队列和批量写入，不阻塞流式 UI。
- Context Compaction 在步骤边界或预算阈值执行，不在每个 Token 到达时执行。
- 模型切换只构建必要 Handoff，不重新扫描整个工作区。

### 6.2 稳定性

- Provider 请求、Tool、MCP、Sidecar、数据库和日志写入分别设置超时、取消和错误隔离。
- 单个工具或日志模块崩溃不得导致整个应用退出。
- 长任务定期写轻量 Checkpoint。
- 应用异常退出后只恢复状态，不自动重放危险操作。
- 每次 Release 必须验证启动、内存、CPU、流式延迟、长会话和模型切换回归。

## 7. 最终产品验收

发布前必须真实验证：

- 新用户能在最少步骤内接入一个模型并开始聊天。
- 支持 Tool Calling 的模型能在首次需要时授权后开始 Agent 任务。
- 用户无需理解 Skill、MCP、记忆、上下文压缩即可完成核心任务。
- 模型切换不会丢失用户约束、静默改变数据去向或破坏正在执行的工具。
- 长对话压缩后，任务目标、权限、文件变更和验证状态保持一致。
- 主界面没有大面积高级配置和无关卡片。
- 常用操作可通过键盘完成，但快捷键不会成为使用前提。
- 日志、统计、帮助和反馈完整，但不会拖慢启动和聊天体验。

### 7.1 当前验证状态（2026-08-06）

Web/Desktop Capability 的默认模式、流式、停止、错误、多工具 Activity、审批、主题、语言、窄窗口和设置无障碍已自动化通过。macOS 原生窗口完成启动、Ask 切换和设置烟测。模型切换真实跨 Provider、长上下文真实压缩和原生工作区完整 Agent 任务尚未完成真实端到端验收。
