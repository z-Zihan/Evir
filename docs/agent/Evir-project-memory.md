# Evir Project Memory

> Scope: This memory applies only to the Evir repository.
> Repository: git@github.com:z-Zihan/Evir.git
> Last reviewed commit: 5b5bcbd
> Last updated: 2026-08-05

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

添加 Provider → 输入 API Key → 选择模型 → 测试连接 → Ask/Plan/Agent → 输入任务 → 必要时授权 → 执行

主页面只保留：当前模型、Ask/Plan/Agent、会话、输入框、发送/停止、任务状态和审批。

## 4. Web and Desktop Boundaries

- Web：浏览器直连 API，受 CORS 限制；无本地工具/Shell/MCP
- Desktop：Tauri 2 + Rust；完整 Agent、文件系统、终端、Git、MCP、Skill
- Web API Key 默认仅内存；Desktop 存系统安全凭据库

## 5. Architecture and Dependency Direction

Types → Config → Repository/Port → Service/Use Case → Runtime/Adapter → UI

- UI 不直接访问数据库、Provider SDK、Tauri Command、Shell
- Port 必须有真实 Adapter 和用户入口才算功能完成
- 当前架构债务：feature stores 直接操作 Dexie（已标注注释），StoragePort/IndexedDBAdapter 需扩展以支持索引查询

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
- Desktop 支持 stdio + Streamable HTTP MCP
- 新增 MCP 默认禁用，工具逐项授权

## 11. Personalization Boundaries

- 用户可编辑 USER.md / PERSONA.md / INSTRUCTIONS.md / SOUL.md
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
- 无远程日志后门；诊断 ZIP 用户主动导出

## 14. Design and Interaction Rules

- 关键词：克制、安静、清晰、可信、可审计
- 禁止：大面积渐变、霓虹、玻璃拟态、紫色、机器人插画、满屏圆角卡片
- CSS Variables 语义 Token；Light/Dark/System 主题无闪白
- 设置采用左侧分类 + 右侧内容，分类 ≤12 个
- 所有界面中英文；所有文案走 i18n

## 15. Performance Budgets

| 指标               | 预算         |
| ------------------ | ------------ |
| Web JS gzip        | ≤ 350 KB     |
| 流式首 Token 显示  | ≤ 100ms      |
| Desktop 冷启动 P50 | < 2s         |
| 空闲内存           | ≤ 150 MB     |
| 空闲 CPU           | < 1%         |
| 安装产物           | ≤ 35 MB      |
| 当前实际 Web gzip  | 184.96 KB ✅ |

## 16. Engineering Standards

- React 组件 ≤250 行；Hook/Store ≤200 行；TS 模块 ≤250 行；函数 ≤50 行
- TypeScript strict；禁止 any；禁止空 catch；禁止万能 Store
- 外部输入用 Zod 验证
- 所有长任务支持 AbortSignal
- PR 门禁：format + ESLint + strict TS + tests + build
- 当前 22 tests pass

## 17. Current Implementation Status

**已真实实现：**

- Dexie 存储层（providers/conversations/messages/usage_records/settings）
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
- 架构结构测试（7 项依赖方向检查）
- Adapter 测试（10 项）

**只有骨架：**

- ModelSwitchCoordinator / ContextBuilderPort / PersonalizationPort / ShortcutRegistry / NotificationPort / LoggerPort / Harness Middleware / StoragePort（接口定义，stores 绕过直接用 Dexie）

**未实现：**

- Anthropic/Gemini/OpenAI Responses Adapter
- 模型发现（/models API）
- 模型切换 UI / 快捷键执行 / 通知 / Usage 面板 / 个性化 UI / 附件
- Desktop SQLite/Keychain / Agent Loop / Skill/MCP 完整功能

## 18. Current Development Stage

阶段 0 ✅ 完成
阶段 1（Provider 与纯净聊天 MVP）约 40%

## 19. Verified User Capabilities

用户当前可以：添加 Provider → 测试连接 → 新建会话 → 发送消息 → 看到真实流式回复 → 停止生成 → 刷新恢复 → 切换中英文/主题

## 20. Known Gaps and Risks

1. 只支持 OpenAI Chat Completions 协议，缺 Anthropic/Gemini
2. 无模型发现，用户必须手动输入模型 ID
3. 快捷键只有定义无实现
4. Usage 记录已写但无统计 UI
5. CORS 错误展示不够友好
6. Stores 绕过 StoragePort 直接用 Dexie（架构债务）
7. 无附件支持
8. Desktop 存储未实现

## 21. Active Decisions

- 优先：完善错误分类 → Anthropic Adapter → 模型发现 → 快捷键 → Usage UI
- Stores 暂时直接用 Dexie，后续扩展 StoragePort
- API Key 默认不持久化
- 流式 UI 批量刷新 32ms

## 22. Next Vertical Slice

1. 完善错误分类与 CORS 用户指引
2. 实现 Anthropic Messages Adapter
3. 实现模型发现（/models API + 下拉选择）
4. 实现快捷键监听
5. Usage 统计 UI

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

- 2026-08-05 | 5b5bcbd | 创建项目记忆；阶段0完成 + 聊天垂直切片完成 + P0/P1 修复完成；22 tests pass；Web gzip 184.96 KB
