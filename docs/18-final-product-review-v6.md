# Evir 最终产品审查（V6）

## 1. 审查结论

Evir 当前产品定义已经形成完整闭环，可以进入分阶段开发。最终形态不是“功能越多越好”，而是：

> 一个干净、轻量、本地优先的桌面 Agent。用户接入一个支持工具调用的模型后即可开始；高级能力按需出现，不干扰核心任务。

当前没有发现必须继续增加的新一级产品模块。后续应停止扩张功能清单，把注意力转向真实实现、稳定性、性能、权限和细节验证。

## 2. 四项最高优先级验收

### 2.1 操作简单、方便、快捷

通过：

- 首次路径只配置 Provider、凭据和模型。
- 主界面只保留模型、模式、输入、发送/停止和必要任务状态。
- 系统权限渐进申请。
- 已实现的高级能力进入设置；命令面板尚未实现。
- Web 只呈现 Ask；Desktop 呈现 Ask/Agent，Plan 是 Agent 内部只读阶段。
- 常用操作提供快捷键，但不要求用户学习快捷键才能使用。

需要开发阶段持续验证：首次成功聊天步骤、首次 Agent 任务步骤和关键操作点击数。

### 2.2 性能卓越、快、稳定

通过：

- Tauri 2，不内置完整 Chromium。
- Skill、MCP、Sidecar、Shiki、文档解析和日志查看按需加载。
- 真实流式输出与批量 UI 提交。
- SQLite/文件/日志 IO 不阻塞 UI。
- MCP 和 Sidecar 不随应用启动。
- 性能预算、日志开销和 Release 门禁已定义。
- 长任务有取消、超时、Checkpoint、崩溃恢复和循环检测。

需要开发阶段真实测量，文档指标不能替代基准测试。

### 2.3 界面干净、清爽、交互不复杂

通过：

- 去除常见 AI 模板化渐变、霓虹、巨型空状态和卡片堆叠。
- 主操作路径与高级设置分离。
- Tool/Skill/MCP 只在实际使用时紧凑呈现。
- 设置页按分类组织，复杂配置默认折叠。
- 日志、用量、帮助和反馈不占据主页面。
- 多语言、多主题和可访问性纳入基础规范。

需要开发阶段以中文、英文、亮色、暗色和最小窗口进行视觉验收。

### 2.4 小而美，接入一个模型即可开始

通过，但产品文案必须准确：

- 一个支持 Tool Calling 的模型即可运行 Desktop Agent。
- 普通文本模型可运行 Ask，不承诺电脑操作。
- 不强制第二模型、Embedding、Skill、MCP、账号或后端。
- 上下文摘要默认使用当前模型；本地 Harness 完成结构化裁剪和状态维护。
- 文件、Accessibility 和屏幕录制权限只在首次使用对应工具时申请。

## 3. 关键复杂边界审查

### 3.1 模型切换

当前实现的核心协调路径已有独立测试；真实跨 Provider、附件和运行中切换仍需外部验证：

- 空闲、流式、Tool Pending、Tool Running 和 Agent Step 分别处理。
- 目标模型能力、上下文、附件和协议先检查。
- 跨 Provider 明确新数据去向。
- Agent 切换使用 Handoff Checkpoint。
- Provider 私有 reasoning state 不跨协议泄漏。
- 默认不自动跨 Provider 回退。

### 3.2 上下文压缩

当前实现已有预算、摘要、检查点和约束保留测试；真实超长任务仍需验证：

- 动态 Token Budget。
- 工具输出先归档。
- 文件正文按需重读。
- 用户约束、审批、任务状态和验证单独结构化保存。
- 摘要版本化，可从本地原始记录重建。
- 模型切换到小上下文时重新预算。

### 3.3 Harness

设计规则已闭环；当前实现已把计划内 Harness Middleware 注册到可组合 Component Runtime，并接入请求、上下文、工具调用与完成判定路径：

- Context、Mode、Capability、Skill、Tool Policy、Loop Detection、Checkpoint、Verification 和 Observability 分层。
- 约束通过代码、Lint、测试和 CI 强制执行。
- 文档与 `AGENTS.md` 作为机器可读事实来源。
- Middleware 可拆卸，防止因模型升级而被复杂控制流绑死。
- Tool Policy 是宿主保护项，普通组件不能替换；关闭可移除 Middleware 时采用安全降级。

### 3.4 本地日志

当前仅部分实现：

- 当前设置页可查看脱敏的会话内存事件并导出 JSON。
- Logger 支持订阅，UI 不使用空闲轮询。
- 文件级 Diagnostic/Audit/Crash 分离、滚动、空间上限、日志目录和诊断 ZIP 尚未实现。
- GitHub Issue 预览/附加流程尚未实现。
- 不提供任何远程日志后门。

## 4. 最终首发边界

### 首发必须有

- Provider 接入和真实流式聊天。
- Web Ask；Desktop Ask/Agent，Agent 内部只读规划阶段。
- 工作区、文件、终端基础工具。
- 权限、审计、停止、验证、Diff 与回滚。
- 基础上下文压缩和任务状态。
- 中英文、三主题、快捷键基础。
- 本地日志、诊断导出和帮助。
- macOS Apple Silicon（arm64）、macOS Intel（x64）与 Windows x64 可安装包；下载项明确标注架构。

### 可后续交付

- 完整 Skill 创建器。
- MCP 高级调试。
- 浏览器自动化。
- Computer Use。
- 高级长期记忆。
- 企业 Provider 全协议。
- 本地模型管理 UI。

这些能力可以在架构中预留，但未实现时不要在主界面展示占位入口。

### 4.1 独立伴随产品面

Evir VS Code 与 Evir CLI 是同一产品原则下的独立入口，不是 Desktop 的必装组件：

- VS Code 扩展服务编辑器内 Ask 与受控工作区 Agent，密钥保存在 VS Code SecretStorage，不要求 Desktop 常驻。
- CLI 服务终端与自动化，和 Desktop 共享版本化非敏感 Provider Profile 与系统凭据，但可独立配置和运行。
- 两者复用纯 Provider Core，不复用 React/Tauri/SQLite 具体 Adapter；宿主平台能力与安全边界分别强制执行。
- 首发不强制用户安装任一伴随产品，也不在 Desktop 首次路径展示推广或配置步骤。

当前代码已有可运行骨架和确定性测试，但产品闭环仍未完成：VS Code 缺少完整 Agent 运行/验证证据呈现；CLI 缺少友好配置错误、中英文与稳定机器输出契约。公开发布前必须按 `docs/19-vscode-extension-and-editor-roadmap.md`、`docs/20-cli-product-and-technical-specification.md` 和 `docs/reviews/vscode-cli-product-ui-review.md` 收口，不能用 VSIX/tarball 构建成功代替安装与真实使用验收。

## 5. 不应加入的内容

- 强制账号。
- 积分或会员体系。
- 广告和推荐流。
- Evir 云端必需后端。
- 默认远程遥测。
- 远程日志后门。
- 默认跨 Provider 自动路由。
- 默认无人值守高风险操作。
- 为展示“智能”而增加不可解释的复杂编排。

## 6. 开发阶段停止加功能的规则

出现新想法时，只有同时满足以下条件才能进入开发计划：

1. 解决明确用户问题。
2. 不增加首次使用步骤。
3. 不让主界面更复杂。
4. 不破坏性能预算。
5. 有明确失败、停止、权限和数据闭环。
6. 可以按需加载或放在高级入口。
7. 有测试和可衡量验收标准。

否则记录到 Future Ideas，不进入当前版本。

## 7. 最终判断

Evir 的产品需求已经足够完整。接下来最重要的不是继续写规格，而是让 Coding Agent 严格按阶段实现，并用真实构建、测试、性能数据和跨平台运行结果验证这些设计。

## 8. 阶段 S 证据更新

2026-08-07 的整改建立了 Playwright E2E、358 张 UI 截图矩阵、视觉基准与全设置页 axe 门禁，并补充 390×844/900×500 紧凑布局回归。338 个 TypeScript 测试、7 个 Rust 测试及浏览器质量套件通过；macOS debug 原生应用可启动。详细证据见 `docs/reviews/ui-full-qa-report.md`。

产品仍未发布就绪：真实 Provider、原生多工具 Agent 任务、MCP Runtime、正式性能测量、签名安装包和 Windows 尚未验收；本轮 Mac 锁屏，不能把浏览器 Desktop Runtime 验收替代为原生窗口交互验收。

## 9. 编排实现状态（2026-08-13）

仓库已加入独立编排 Domain、结构化 Task Intake/Planner、机械 Plan 校验、事件优先存储、DAG Scheduler、资源冲突串行、同模型受限 Worker、六个可信内置子图和聊天内任务工作台。旧 Agent Loop 继续作为节点执行器和兼容路径，Tool Registry/Harness/审批边界没有下放给模型。

该状态只代表仓库实现与确定性自动化范围。真实 Provider 的结构化输出差异、原生 Desktop 多 Worker、系统审批、崩溃恢复、Diff/回滚、性能和手工屏幕阅读器仍必须按产品计划单独验收；完成这些证据前不得把新 Scheduler 宣布为默认发布就绪。
