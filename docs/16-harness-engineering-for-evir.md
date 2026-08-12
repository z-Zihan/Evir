# Evir Harness Engineering 规范

## 1. 为什么 Evir 需要 Harness

Evir 的能力不应被理解为“模型 API + 聊天界面”。模型负责智能判断，Harness 负责让这种判断在真实电脑环境中可控、可靠、可验证地执行。

```text
Evir Agent = Model + Harness
```

Harness 包括：

- 上下文构建。
- 模式与权限策略。
- Tool/MCP 执行。
- Skill 路由。
- 循环和异常检测。
- 状态、记忆与生命周期。
- 自验证与完成判断。
- 日志、指标和诊断。
- 文档与架构约束。

## 2. Evir 的 Harness 分层

```text
User Request
  → Input Normalization
  → Mode Policy
  → Provider Capability Gate
  → Context Budget
  → Skill Selection
  → Tool Registry Assembly
  → Model Invocation
  → Tool Policy / Approval
  → Runtime Execution
  → Loop Detection
  → Verification
  → Completion / Recovery
```

每一层必须可独立测试、启用、禁用和替换，避免把全部控制流写成一个不可拆卸的 Agent Loop。

### 2.1 Middleware 建议

- `InputNormalizationMiddleware`：统一消息、附件和模型参数。
- `ModePolicyMiddleware`：Ask / Plan / Agent 工具边界。
- `CapabilityGateMiddleware`：检查模型、Runtime 和系统权限。
- `ContextBudgetMiddleware`：预算、压缩和检索。
- `SkillRoutingMiddleware`：只加载命中的 Skill。
- `ToolPolicyMiddleware`：Schema、风险、网络和审批。
- `LoopDetectionMiddleware`：重复调用、重复编辑、无进展循环。
- `CheckpointMiddleware`：长任务和模型切换安全检查点。
- `VerificationMiddleware`：完成前运行可验证检查。
- `ObservabilityMiddleware`：统一 trace、usage、日志和性能事件。

Middleware 不得修改高于自身权限层的安全规则。

## 3. 上下文工程

Evir 必须同时管理：

### 静态上下文

- 产品和安全规则。
- 当前项目的 `AGENTS.md`、架构文档和开发规范。
- Skill 指令。
- Tool Schema。

### 动态上下文

- 当前任务状态。
- 相关日志和指标摘要。
- 工作区结构。
- Tool 结果。
- 测试、构建和 Git 状态。
- 相关长期记忆。

原则：Agent 无法访问的信息，对 Agent 来说等于不存在。Evir 自身的产品决策、架构规则和验收标准必须保存在仓库内，并作为机器可读的事实来源。

## 4. 架构约束必须机械执行

不能只在 Prompt 中要求“写出可维护代码”。需要通过确定性工具执行：

```text
Types → Config → Repository → Service → Runtime → UI
```

建议 Harness 检查：

- Import 边界和循环依赖。
- UI 不直接调用 Tauri、Provider SDK、SQLite、Shell。
- 文件与函数规模。
- `any`、空 catch、未处理 Promise。
- i18n 硬编码文案。
- 固定颜色和主题违规。
- 未经 Schema 校验的 Tool 输入。
- 未脱敏日志。
- Provider Adapter 泄漏到业务层。

通过 ESLint、自定义结构测试、Rust tests、CI 和 pre-commit 强制执行。

## 5. 反馈循环

Agent 只有获得确定反馈，才能可靠收敛。

每类任务都应定义验证器，例如：

- 代码任务：typecheck、lint、test、build、Git diff。
- 文件任务：目标文件存在、内容结构和校验和。
- 浏览器任务：页面状态、URL、可见元素和结果截图。
- MCP 任务：响应 Schema、错误码和副作用确认。
- Computer Use：目标窗口状态和用户可见结果。

禁止仅以模型文本“已完成”结束任务。

## 6. 循环检测与失败升级

Harness 至少识别：

- 相同 Tool + 相同参数连续调用。
- 同一文件来回修改。
- 错误没有变化的重复重试。
- 计划步骤长期无进展。
- Token 持续消耗但没有新增 Artifact 或验证证据。

触发阈值后：

1. 暂停自动执行。
2. 生成当前状态和失败模式摘要。
3. 尝试一次不同策略。
4. 仍失败则请求用户决策，不无限循环。

## 7. 熵管理

随着 Evir 与其生成的项目不断演进，应建立周期性但非强制后台常驻的维护任务：

- 文档与代码一致性检查。
- 架构约束扫描。
- 废弃 Provider/协议元数据检查。
- Skill 版本与依赖检查。
- 重复 Prompt、工具和组件扫描。
- 依赖、包体积和性能回归检查。
- 日志 Schema 与脱敏规则审查。

这些任务应由开发流程或 CI 触发，而不是让普通用户设备持续运行维护 Agent。

## 8. Harness 必须可拆卸

模型能力会变化。Evir 不应把大量启发式逻辑写死：

- 每个 Middleware 有明确开关和版本。
- Prompt、压缩和路由策略记录版本。
- 新模型上线后可对 Harness 组件做 A/B 或回归评估。
- 当模型原生能力足够可靠时，应能移除多余中间层。

控制流越复杂，越需要证明其收益。没有指标提升的“聪明逻辑”不应进入核心路径。

## 9. Harness 可观测性

每个 Agent Run 生成统一 Trace：

```text
run_id
conversation_id
provider / model / protocol
mode
active skills
available tools
context budget snapshots
tool calls and approvals
loop detection events
checkpoints
verification evidence
usage and timing
final status
```

默认日志必须脱敏。详细设计见 `docs/17-local-logging-and-diagnostics.md`。

## 10. Evir Harness 验收

- 更换模型不要求重写 Agent Core。
- 关闭某个 Middleware 后系统仍可运行。
- Agent 不能绕过 Tool Registry 和权限层。
- 每个任务都有可观察状态和停止机制。
- 每次完成都有验证证据。
- 无进展循环能被识别和终止。
- 文档、代码和 CI 构成同一事实来源。
- Harness 增强能力，但不会让产品主流程变复杂。

## 11. 跨宿主运行事件

Desktop、VS Code 和 CLI 可以拥有不同 Runtime Adapter，但 Agent Harness 应输出同一版本化事件语义：

```text
run-start → step → tool-pending → approval → tool-result
          → verification → completed | partial | stopped | failed
```

- 事件只包含安全摘要和 Artifact 引用，不携带宿主对象或无限原始输出。
- VS Code Host 将事件映射为 Webview Activity；CLI 将事件映射为 stderr 人类文本或 stdout JSONL。
- Presenter 不得自行把模型文本、流结束或退出码 0 转成 `completed`；CompletionVerifier 是唯一完成判定来源。
- 宿主可增加 activation、view、terminal 等本地事件，但不能改变 Tool Policy、风险或验证语义。

## 12. 动态组件组装

Harness 的可拆卸性由 `ComponentRuntime` 提供生命周期基础：组件声明 `provides/requires`，每项注册通过 `EffectScope` 生成逆操作，配置或代码定义变化时只重载受影响组件及其传递依赖者。新图激活失败必须恢复旧图，不能留下部分注册的 Tool 或监听器。

第一阶段已将 Desktop filesystem、terminal 和 git 工具从 `createRuntime` 的硬编码循环迁移为可信内置组件。Middleware、工作流与 UI Slot 后续接入同一协议，但 Permission、Tool Policy 和 Tauri 强制边界不得成为可被普通组件替换的贡献点。详细设计与验收见 `docs/21-composable-component-runtime.md`。
