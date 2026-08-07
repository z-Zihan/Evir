# Evir Project Memory

> Scope: This memory applies only to the Evir repository.
> Repository: git@github.com:z-Zihan/Evir.git
> Last reviewed baseline: 9bcbb80 + 2026-08-07 remediation working tree
> Last updated: 2026-08-07

## 1. Product Identity

Evir 是本地优先、BYOM 的多模型 AI 客户端与通用桌面 Agent。同一代码库产出 Web（静态部署的聊天客户端）和 Desktop（Tauri 2 Agent）。无账号、无积分、无广告、无强制业务后端。接入一个支持 Tool Calling 的模型即可开始 Desktop Agent。

## 2. Non-Negotiable Product Principles

- 操作简单、方便、快捷；性能快、稳定、轻量
- UI 干净、克制、去 AI 模板感；主交互路径不复杂
- 高级能力按需出现，不污染主界面
- 数据默认本地；用户可停止 Agent；高风险操作必须审批
- 不得用 Mock、Port、类型或静态 UI 冒充功能完成
- 文档优先级：用户要求 > AGENTS.md > docs/18 > docs/01 > docs/12 > 专项文档 > 架构 > 设计 > 工程 > 开发计划 > README > references/

## 3. Primary User Flow

添加 Provider → 输入 API Key → 选择模型 → 测试连接 → Web Ask 或 Desktop Ask/Agent → 输入任务 → 必要时授权 → 执行

主页面只保留：当前模型、Web Ask 或 Desktop Ask/Agent、会话、输入框、发送/停止、任务状态和审批。Plan 是 Agent 内部只读阶段。

## 4. Web and Desktop Boundaries

- Web：浏览器直连 API，受 CORS 限制；无本地工具/Shell/MCP
- Desktop：Tauri 2 + Rust；Agent、文件系统、终端、Git、Skill，以及 MCP 配置页；MCP Runtime 尚未实现
- Web API Key 默认仅内存；Desktop 存系统安全凭据库

## 5. Architecture and Dependency Direction

Types → Config → Repository/Port → Service/Use Case → Runtime/Adapter → UI

- UI 不直接访问数据库、Provider SDK、Tauri Command、Shell
- Port 必须有真实 Adapter 和用户入口才算功能完成
- Feature stores 统一经 `StoragePort`；Web 使用 IndexedDB Adapter，真实 Tauri Desktop 使用 SQLite-backed structured storage，浏览器 Desktop Runtime 回退 IndexedDB

## 6. Runtime and Capability Rules

- EvirRuntime 区分 Web/Desktop，按 Capability 注册工具
- Ask 不主动操作本地资源；Plan 只读检查；Agent 权限控制执行
- Tool Registry 按模式和风险过滤，非仅 Prompt 约束

## 7. Provider and Protocol Rules

- Provider Preset → Protocol Adapter → Model Profile 三层分离
- 真实流式输出（fetch + SSE），禁止假打字机
- 错误统一映射 12 种 ProviderErrorType
- Agent 模式要求模型支持 Tool Calling
- 模型切换经 ModelSwitchCoordinator + 安全检查点
- 不默认跨 Provider 自动降级

## 8. Agent, Tool and Permission Rules

- 风险分级 L0-L4；L3 逐次审批，L4 可禁用
- 工具来源标记：evir-local / mcp-local / mcp-remote / provider-server
- 网络权限：读取互联网与上传本地内容是两个独立权限
- Provider 服务端工具默认关闭

## 9. Context, Compression and Memory Rules

- 单模型即可完成上下文压缩
- 预算阈值：<60% 不摘要，60-75% 归档工具输出，75-90% 摘要旧对话，>90% 强制检查点
- 永远保留：用户消息、约束、目标、步骤、权限、失败、文件路径/版本、验证证据
- 摘要版本化，不无限摘要的摘要

## 10. Skill and MCP Rules

- Skill 定义方法，MCP 提供工具
- Web 第一版仅支持指令型 Skill，不支持 MCP
- Desktop 的 stdio + Streamable HTTP MCP 是目标能力；当前只有配置管理，没有连接/发现/调用 Runtime
- 新增 MCP 默认禁用，工具逐项授权

## 11. Personalization Boundaries

- 当前用户可设置简单详情和回复风格；USER.md / PERSONA.md / INSTRUCTIONS.md / SOUL.md 编辑器尚未实现
- 不可编辑 Evir Core / Security / Permission / Tool Policy
- 用户内容始终是低优先级上下文，不能提权
- 个性化可一键关闭

## 12. Storage, Artifact and Recovery Rules

- Keychain → 轻量配置 → SQLite/IndexedDB → Artifact 文件 → 临时存储
- 核心 14+ 实体（providers/conversations/messages/usage_records 等）
- Schema Migration 单向递增，迁移前备份
- 隐私会话不持久化

## 13. Logging and Diagnostic Rules

- 统一 LoggerPort + correlation ID（session/run/step/tool/request）
- 默认脱敏、本地、异步有界队列
- 禁止记录 API Key/Authorization/Cookie/完整会话/文件正文
- 无远程日志后门；当前只查看脱敏会话内存事件并导出 JSON，文件日志和诊断 ZIP 尚未实现

## 14. Design and Interaction Rules

- 关键词：克制、安静、清晰、可信、可审计
- 禁止：大面积渐变、霓虹、玻璃拟态、紫色、机器人插画、满屏圆角卡片
- CSS Variables 语义 Token；Light/Dark/System 主题无闪白
- 设置采用左侧分类 + 右侧内容，分类 ≤12 个
- 所有界面中英文；所有文案走 i18n
- 图标按钮有可访问名称和 tooltip；对话框具备首焦点、焦点循环、Escape 和焦点恢复
- 嵌套浮层优先处理 Escape；滚动区域可聚焦并有名称；选中控件暴露语义状态
- 取消的 Agent Run 不得显示完成；未经实时验证不得使用“已连接”文案

## 15. Performance Budgets

| 指标               | 预算                      |
| ------------------ | ------------------------- |
| Web JS gzip        | ≤ 350 KB                  |
| 流式首 Token 显示  | ≤ 100ms                   |
| Desktop 冷启动 P50 | < 2s                      |
| 空闲内存           | ≤ 150 MB                  |
| 空闲 CPU           | < 1%                      |
| 安装产物           | ≤ 35 MB                   |
| 当前实际 Web gzip  | 280.06 KB（2026-08-07）✅ |

## 16. Engineering Standards

- React 组件 ≤600 行；Hook/Store ≤600 行；TS 模块 ≤600 行；函数 ≤200 行
- TypeScript strict；禁止 any；禁止空 catch；禁止万能 Store
- 外部输入用 Zod 验证
- 所有长任务支持 AbortSignal
- PR 门禁：format + ESLint + strict TS + tests + build
- 当前 338 TS tests + 7 Rust tests pass

## 17. Current Implementation Status

**已真实实现：**

- StoragePort 分层存储：Web IndexedDB；真实 Tauri Desktop SQLite structured entities
- OpenAI Chat Completions Adapter（真实 fetch + SSE 流式）
- OpenAI Compatible Chat Adapter
- Provider Store（Zod 验证 + IndexedDB + 测试连接）
- Chat Store + Chat Stream（真实流式、停止生成、32ms 批量 UI、Usage 记录）
- Sidebar（会话列表、新建/删除/选择）
- ChatView（Markdown 渲染、流式实时显示、停止生成、错误展示）
- ProviderSettings（添加/删除/设默认/测试连接表单）
- SettingsModal
- i18n 中英文完整
- Light/Dark/System 主题
- 架构结构测试（8 项依赖方向检查 + i18n key 完整性）
- Adapter 测试（10 项）
- 重新生成 / 编辑重试
- Agent Loop + Tool Registry（read_file, list_directory, write_file）
- L3 工具审批流（Approve/Deny 按钮接线）
- 会话分支（从任意消息 fork）
- 模型切换 UI（inline dropdown）
- Skill 系统（Registry + Store + Settings UI + Prompt 注入）
- 共享 helpers（chat-helpers.ts）
- MCP Server 配置（Store + Settings UI）；页面明确不代表已连接
- Context Budget Manager + Tool Output 压缩
- Sidebar 搜索 + Cmd+Shift+F 快捷键
- Shortcuts 设置面板（平台感知格式化）
- Privacy 设置面板（清除本地数据 + 事务保护）
- 共享 platform.ts（isMac + currentPlatform）

**阶段 2 新增：**

- 工作区系统（WorkspaceSelector + Runtime 封装的 Tauri directory picker）
- 13 个本地工具（read/write/list/search/patch/stat/mkdir/snapshot/restore + run_command + git_status/diff）
- 符号链接逃逸检测 + workspace 边界验证
- 文件快照与回滚（FNV-1a Hash + 冲突检测）
- Agent Loop 循环检测（6 次警告 / 12 次停止）
- 验证循环（自动检测项目类型 → 运行 check/test/build）
- AgentRunSummary UI（文件变更/命令结果/验证/Diff/错误）
- Tauri capabilities（dialog/fs/shell/store 权限）
- Desktop 已启动验证（pnpm dev:desktop ✅）

**阶段 3 新增：**

- LLM 对话摘要（>75% 自动用模型压缩旧消息，保留目标/约束/文件路径/命令/错误）
- 记忆系统（会话/工作区/全局 + pinned + 隐私会话 + Dexie 持久化）
- MemorySettings UI（设置面板 memory tab，增删改查+置顶）
- Checkpoint（>90% 自动保存 + 崩溃恢复检测 + clearCheckpoint）
- 模型切换 Handoff（buildHandoffMessage 保留目标/步骤/错误）
- crash-recovery.ts（findUnfinishedRuns 扫描中断的 checkpoint）
- 隐私会话 toggle（Sidebar 🔒/🔓 按钮，跳过记忆注入）

**阶段 4 新增：**

- Skill 创建/删除/导入（skill-store: importSkill/createSkill/deleteSkill）
- Skill 路由器（关键词匹配 + 模式表 + 匹配原因，6 tests）
- SkillSettings UI 升级（创建表单 + 删除按钮 + 源标记）
- 路由接入 stream-response（<skill_routing> XML 注入）
- About 面板（版本号、描述、GitHub 链接、许可证）
- 对话置顶 + 内联重命名（双击/按钮，Enter/Escape/blur）
- Markdown 导出（单对话 .md，角色标签 + 附件列表）
- 自动标题生成（首条消息截断 30 字）
- 删除对话确认弹窗
- 消息复制按钮（clipboard + 1.5s 反馈）
- 会话列表按 updatedAt 降序排序

**部分实现：**

- ModelSwitchCoordinator、ContextBuilder、Logger、StoragePort 和 Harness 各层已有实现/测试，但真实跨 Provider、完整中间件编排和文件日志仍需继续验证或实现
- Personalization 目前是简单偏好；Notification 和命令面板未实现

**未实现：**

- MCP Server 实际连接（当前仅配置管理，无 stdio/HTTP 通信）
- 文件级 Diagnostic/Audit/Crash 日志、日志目录、详细模式与诊断 ZIP
- 通知、命令面板、应用内帮助/反馈和高级 Markdown 个性化编辑器
- 更多 Provider 协议（Azure, Bedrock）

## 18. Current Development Stage

阶段 0 ✅ 完成
阶段 1（Provider 与纯净聊天 MVP）🔧 92% — 确定性自动化完成，真实多 Provider 网络验收未重复
阶段 2（Desktop Agent 与本地工具）🔧 78% — 12 工具+快照+循环检测+验证+UI，原生真实任务未验收
阶段 3（上下文压缩与记忆）✅ 完成 — LLM 摘要+记忆系统+Checkpoint+Handoff+隐私会话+崩溃恢复
阶段 4（Skill 系统）🔧 核心完成 — 路由+创建/删除/导入+5 内置 Skill
阶段 S（稳定性与体验整改）✅ 仓库内确定性范围完成；真实原生/外部发布门槛未全部通过

## 19. Verified User Capabilities

用户当前可以：添加 Provider（5 种协议）→ 测试连接 → 获取模型列表 → 新建会话 → 发送消息/附件 → 看到流式回复 → 停止生成 → 刷新恢复 → 快捷键操作 → 会话搜索 → 查看 Usage 统计 → 分类错误展示 → 拖拽上传图片/文本附件 → 历史附件参与多轮对话 → 会话导出/导入 → Web Ask / Desktop Ask 与 Agent → 个性化设置 → 切换中英文/主题 → 重新生成/编辑消息 → 会话分支 → 模型切换 → Agent 模式工具审批 → Skill 启用/禁用。Plan 是 Agent 内部阶段，不是常驻一级入口。

2026-08-07 自动化证据：338 TypeScript tests、7 Rust tests、24 E2E pass + 6 Web capability skips、358 UI screenshots、6 visual baselines、16 accessibility tests。macOS debug 原生应用已启动；本轮 Mac 锁屏，未声明原生窗口交互通过。

## 20. Known Gaps and Risks

1. MCP Server 仅配置管理，无实际连接
2. Desktop Agent 原生真实端到端验收待完成（工作区修改、验证、Diff、回滚和系统权限）
3. macOS 签名身份缺失，`.app` 在 codesign 阶段失败；Windows 未验证
4. Web 主 chunk 仍较大，虽在 gzip 总预算内但需后续拆分
5. 真实付费 Provider、跨 Provider 网络和超时条件未在本轮自动化执行
6. Desktop 冷启动分位、空闲 CPU/内存和大输出性能未正式测量
7. 手工 VoiceOver/屏幕阅读器验收未完成

## 21. Active Decisions

- 当前优先级是完成阶段 S 真实验收，不新增 Provider、Skill、MCP 或 Computer Use 产品能力
- Web 使用 IndexedDB；真实 Tauri Desktop 的结构化实体走 SQLite Adapter
- Web 只提供聊天/附件；Desktop 默认 Agent、可切换 Ask，Plan 不作为一级入口
- Tool Registry 与 Tauri 命令双层强制工作区边界；清除工作区立即撤销本地工具范围
- 流式 UI 使用 animation frame 批量刷新

## 22. Next Vertical Slice

1. 使用测试工作区完成原生 Desktop 多工具任务和回滚验收
2. 使用真实 Provider 验证聊天、错误、超时与跨 Provider 数据去向
3. 补测 Desktop 冷启动、空闲 CPU/内存、长会话和大输出
4. 在具备签名身份与 Windows Runner 的环境完成安装包验收
5. 实现并验证 MCP Runtime 后再把配置状态升级为连接状态

## 23. Relevant Source Documents

- [AGENTS.md](../../AGENTS.md)
- [docs/01-product-requirements.md](../01-product-requirements.md)
- [docs/02-technical-architecture.md](../02-technical-architecture.md)
- [docs/04-design-specification.md](../04-design-specification.md)
- [docs/05-engineering-standards.md](../05-engineering-standards.md)
- [docs/06-development-plan.md](../06-development-plan.md)
- [docs/10-streaming-and-performance.md](../10-streaming-and-performance.md)
- [docs/13-provider-and-protocol-matrix.md](../13-provider-and-protocol-matrix.md)
- [docs/15-final-experience-model-switching-and-context.md](../15-final-experience-model-switching-and-context.md)
- [docs/16-harness-engineering-for-evir.md](../16-harness-engineering-for-evir.md)
- [docs/17-local-logging-and-diagnostics.md](../17-local-logging-and-diagnostics.md)
- [docs/18-final-product-review-v6.md](../18-final-product-review-v6.md)

## 24. Update Log

- 2026-08-07 | working tree | 全量 UI/UX/产品逻辑整改：P0/P1 开放项 0；338 TS + 7 Rust tests；24 E2E + 358 screenshots + 6 visual + 16 a11y；补充 390×844 与 900×500 紧凑布局，Desktop SQLite structured storage、Agent 证据持久化、工作区 Runtime 边界、对话框/键盘/取消态和文档真实性收口

- 2026-08-06 | working tree | 阶段 S 自动化与体验整改：298 TS + 5 Rust tests；9 E2E + 48 UI screenshots + 6 visual + 4 a11y；工作区 P0 边界、Web/Desktop 能力、确认对话框、对比度、设置键盘与 Desktop 文案修复；Web gzip 271.08 KB

- 2026-08-05 | 5b5bcbd | 创建项目记忆；阶段0完成 + 聊天垂直切片完成 + P0/P1 修复完成；22 tests pass；Web gzip 184.96 KB
- 2026-08-05 | 82f20f3 | Anthropic Messages Adapter + 模型发现 + 快捷键监听 + review 修复；30 tests pass；Web gzip 186.94 KB
- 2026-08-05 | 1e7b804 | Usage 统计面板 + 会话搜索 + 错误分类展示（12 种 ProviderErrorType）；30 tests pass；Web gzip 189.05 KB
- 2026-08-05 | e915a22 | 附件支持（图片/文本/拖拽/4 协议多模态）+ Gemini Adapter + OpenAI Responses Adapter + review 修复；63 tests pass；Web gzip 192.04 KB
- 2026-08-05 | 2046d54 | 历史附件参与多轮请求 + 会话导出/导入 + 模式切换 + 个性化设置；65 tests pass；阶段1 完成
- 2026-08-05 | 57eee0c | Desktop Tauri Rust 端基础（SQLite/Keychain/文件系统）；1 Rust test + 65 TS tests pass；review 发现 5 P0（安全）+ 7 P1
- 2026-08-06 | c535f0a | 重新生成 + 编辑重试（stream-response.ts 共享 helper, send-message 重构, ChatMessage 组件）；79 tests pass
- 2026-08-06 | 797e4ac | Agent Loop + Tool Registry（tool-registry-impl, tool-executor, local-file-tools, agent-loop, ToolCallCard UI）；91 tests pass
- 2026-08-06 | dcfe3c9 | Agent Loop P0+P1 review 修复（路径遍历防护, L3 权限, DI, onDelta 修复）；92 tests pass
- 2026-08-06 | 8601edf | Agent Loop P2 review 修复（draft sync, modeHint i18n, Approve/Deny 按钮 UI）；92 tests pass
- 2026-08-06 | 698f10c | 会话分支（parentConversationId, branchConversation, ChatMessage branch 按钮）；100 tests pass
- 2026-08-06 | b8492c7 | 分支 review 修复（toolCalls/toolResults ID remap, bulkAdd, i18n）；101 tests pass
- 2026-08-06 | cada526 | 模型切换 UI（ModelSwitcher dropdown, provider-store switchProvider）；105 tests pass
- 2026-08-06 | 8f527cd | Skill 系统（Registry + Store + Settings UI + Prompt 注入）；114 tests pass
- 2026-08-06 | 3f4a11a | Skill review P0+P1 修复（类型安全, prompt 注入防护, 竞态, 双状态源）；114 tests pass
- 2026-08-06 | 3fe30d4 | ToolCallCard Approve/Deny 接线（tool-approval.ts, continueAgentLoop, pendingToolApproval 状态）；114 tests pass
- 2026-08-06 | d1949a6 | Tool approval review P0+P1 修复（CSS 损坏, 静态 import, chat-helpers.ts, 消息去重）；114 tests pass
- 2026-08-06 | e7c47d0 | Review P1 修复（TOOL_DENIED 常量, for...of 循环, NOTE 注释恢复）；114 tests pass；Web gzip 208.11 KB
- 2026-08-06 | 21dd361 | 项目记忆更新（13 commits, 114 tests, 208 KB gzip）
- 2026-08-06 | 5208513 | Sidebar 搜索 + Cmd+Shift+F 快捷键（i18n + CSS + ref-based focus）；114 tests pass
- 2026-08-06 | de6cde5 | Sidebar 搜索 P0 修复（CustomEvent → ref-based focus）
- 2026-08-06 | 9fa7073 | MCP Server 配置（Store + Settings UI + DB schema v3）；119 tests pass
- 2026-08-06 | 1f89692 | MCP review P0+P1 修复（DB-first writes, 类型收窄, headers, try/catch）；119 tests pass
- 2026-08-06 | 0dd6540 | Context Budget Manager + Tool Output 压缩（token 估算, 4 级压缩, 按比例截断）；135 tests pass
- 2026-08-06 | ef4b5e9 | Context budget review P0+P1 修复（token 估算修正, 比例截断, 阈值常量）；135 tests pass
- 2026-08-06 | 36c2d5a | Shortcuts 设置面板（9 个快捷键展示 + 平台感知格式化）；139 tests pass
- 2026-08-06 | f27e7be | Shortcuts review P1 修复（共享 platform.ts, Mac 格式化, 平台过滤）；139 tests pass
- 2026-08-06 | a4a3a48 | Privacy 设置面板（5 个清除按钮 + 确认对话框 + 事务保护）；143 tests pass
- 2026-08-06 | 1a5bb0f | Privacy review P0+P1 修复（事务原子性, 禁用态, role=alert, CSS class）；143 tests pass
- 2026-08-06 | e36a99e | 项目记忆更新（23 commits, 143 tests）
- 2026-08-06 | b33d1f8 | About 面板（版本号 from package.json, GitHub 链接, 许可证）；145 tests pass
- 2026-08-06 | 9ee398c | About review P1 修复（package.json import, SettingsTab 类型提取）；145 tests pass
- 2026-08-06 | 0c5436e | 对话置顶 + 内联重命名（pinned 字段, 双击重命名, Pin 按钮）；149 tests pass
- 2026-08-06 | 3bf32c4 | Markdown 导出（.md 文件, 角色标签, 附件列表）+ lint 修复；153 tests pass
- 2026-08-06 | 0440c79 | Pin/Rename review P0+P1 修复（guard ref, Pencil 图标, 错误处理, maxLength）；153 tests pass
- 2026-08-06 | 37d435c | 自动标题生成（首条消息截断 30 字 + …）；153 tests pass
- 2026-08-06 | 68efbb0 | Combined review P1 修复（export 错误处理, escapeMd 完善, DRY 重构）；153 tests pass
- 2026-08-06 | e61e459 | 删除确认弹窗 + 消息复制按钮（clipboard + 1.5s 反馈）；153 tests pass
- 2026-08-06 | 29195a1 | 会话列表按 updatedAt 降序排序；153 tests pass
- 2026-08-06 | 5c2f531 | 项目记忆更新（33 commits, 153 tests）
- 2026-08-06 | 34aea6a | 技术债：tool-approval + chat-store 拆分到行数限制内；153 tests
- 2026-08-06 | 5d24a45 | 消息时间戳 + Token 计数显示；153 tests
- 2026-08-06 | 98a9379 | 快捷键帮助面板 (⌘/)；153 tests
- 2026-08-06 | a3bfc27 | 代码块复制按钮；153 tests
- 2026-08-06 | bf379e6 | 错误重试按钮；153 tests
- 2026-08-06 | 5bc5697 | 输入框自动调整高度 + ChatView 拆分；153 tests
- 2026-08-06 | 8db190c | 行数限制 200/250→600；函数 50→200
- 2026-08-06 | 0440c79→68efbb0 | Pin/rename + Markdown export review 修复；153 tests
- 2026-08-06 | e61e459 | 删除确认弹窗 + 消息复制按钮；153 tests
- 2026-08-06 | 0963630 | CSS 变量别名 + 测试连接修复；153 tests
- 2026-08-06 | 3de1594 | 设置弹窗不再因背景点击关闭
- 2026-08-06 | 3dd3b81 | 测试连接/获取模型不要求 name 字段
- 2026-08-06 | 5829a1b | URL 自动补 /v1
- 2026-08-06 | 0cd01d1 | API Key 默认持久化
- 2026-08-06 | 24035bb | 移除自动弹出设置 + 修复时间戳
- 2026-08-06 | ca362aa | 阶段 2：workspace + file tools + terminal + git（5 Rust commands, 5 TS tools）
- 2026-08-06 | bffc2e7 | WorkspaceSelector UI + i18n + CSS
- 2026-08-06 | a18591d | 符号链接防护 + 快照回滚 + 循环检测 + 4 新工具
- 2026-08-06 | 8bb132e | 验证循环 + AgentRunSummary UI
- 2026-08-06 | 027ac75 | 21 新测试（工具/path/mode isolation）；184 tests
- 2026-08-06 | 35142bc | Desktop layout 修复（WorkspaceSelector 不再破坏 grid）
- 2026-08-06 | ccc8226 | Tauri capabilities（dialog/fs/shell 权限）
- 2026-08-06 | 332e2d3 | Agent 模式系统提示加强（显式列出工具）；184 tests
- 2026-08-06 | 1a5bb0f | Privacy review P0+P1 修复（事务保护, disabled 状态, 无障碍）；143 tests pass
