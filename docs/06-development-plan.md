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

### S9：性能与稳定性回归
- ⬜ Web gzip 检查
- ⬜ 长会话渲染性能检查
- ⬜ 工具流式事件批量更新检查

### S10：Web/Desktop 手动验收
- ⬜ Web：聊天/附件/会话管理/设置
- ⬜ Desktop：Agent 工具调用/工作区/审批

### 阶段 S 完成标准
- 所有 P1 Bug 修复
- 信息架构调整完成
- Agent UI 重构完成
- 视觉系统统一
- 文档与代码一致
- Web + Desktop 手动验收通过

## 阶段 2：Desktop Agent 与内置工具

交付：Ask/Plan/Agent 完整边界、Agent Loop、工作区授权、只读 Plan 工具、文件/搜索/Patch、受控终端、Git 只读工具、权限分级、审计、取消、Diff 与回滚；接入任务完成、审批和失败系统通知；支持可选 Desktop 全局快捷键。

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

## 阶段 6：通用工具与浏览器自动化

交付：文档/数据工具、文件整理、Playwright Sidecar、下载/上传保护、Sidecar 生命周期与跨平台产物。Provider 服务端工具在本阶段前后按独立来源接入。

## 阶段 7：Computer Use

交付：macOS Accessibility、Windows UI Automation、截图、窗口/控件识别、键鼠事件、渐进系统权限、敏感操作保护和多显示器处理。

## 阶段 8：发布质量

交付：macOS/Windows 构建矩阵、签名、公证、自动更新、数据迁移、隐私与许可证；完整本地 Diagnostic/Audit/Crash 日志、日志目录管理、脱敏、滚动与诊断 ZIP 导出；性能基线、包体积检查、内存/CPU/日志开销回归和启动性能门禁。

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
