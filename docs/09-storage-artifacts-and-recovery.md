# Evir 本地存储、Artifact 与恢复规范

## 1. 为什么需要本地结构化存储

Evir 不建设云端业务后端，但仍需要在用户电脑保存会话、消息、任务状态、工具执行、记忆、Skill、MCP 配置和全文搜索索引。SQLite 是嵌入式库：它直接读写本地文件，不监听端口、不需要单独安装服务，也不会把数据上传到云端。

如果只使用 JSON 文件，随着消息、任务和记忆增多，会出现并发写入、部分损坏、查询缓慢、迁移困难和全文搜索复杂等问题。SQLite 用于解决这些结构化数据问题，而不是把 Evir 变成传统前后端应用。

## 2. 分层存储

- Keychain/Credential Manager：API Key、Token、敏感 Header。
- 轻量配置：语言、主题、窗口、功能开关。
- SQLite Adapter：结构化记录和索引。
- Artifact Store：附件、完整日志、Diff、快照、生成文件、备份。
- Memory/Temporary Adapter：隐私会话与可丢弃数据。

UI、Agent Core、Skill 和 MCP 只能依赖 Storage Port，不得直接写 SQL。

## 3. 核心实体

- providers / model_profiles / model_capabilities / usage_records
- conversations / messages / attachments
- agent_runs / plans / run_steps
- tool_executions / approvals
- workspaces / network_policies
- memories
- skills / skill_versions / activated_skills
- mcp_servers / mcp_capabilities / mcp_logs
- artifacts / snapshots / backups
- personalization_documents / shortcut_bindings / notification_settings
- settings / schema_migrations

## 4. Artifact

Artifact 是任务产生或使用的较大内容，不应全部放进消息正文或 React 状态：文件、文档、代码、图片、表格、日志、Diff、归档、快照。数据库只保存元数据、路径、摘要、哈希和关联关系。

## 5. 隐私模式

隐私会话不写入长期数据库，不生成长期记忆，临时附件和日志在会话关闭后清理。API 调用仍会受到用户所选模型服务商的数据策略约束，Evir 应明确提示。

## 6. 迁移与恢复

- Migration 单向递增，不修改已发布迁移。
- 迁移前对关键数据生成备份。
- 任务状态使用事务或可恢复事件记录。
- 异常退出后显示未完成任务，只恢复状态，不自动重放工具。
- 用户可选择继续、查看或放弃。

## 7. 导入导出

备份包建议使用 `.evir-backup`，包含 manifest、结构化数据、Skill、非敏感 MCP 配置和 Artifact 索引。API Key 默认不导出；用户明确选择时必须密码加密。
