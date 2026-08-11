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
- Shared Provider Profile：Desktop/CLI 共用的版本化非敏感 `providers.json`；API Key 仍只在 Keychain/Credential Manager。
- VS Code Extension Storage：独立保存扩展 Provider 元数据、会话和最后写入记录；API Key 进入 VS Code SecretStorage，不读取 Shared Provider Profile。

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
- `providers.json` 当前 Schema 为 `version: 1`。Desktop 按 `updatedAt` 合并 CLI 写入项，并把旧 Desktop Provider 导出到共享 Profile；旧 CLI `config.json` 保持只读兼容并在下次配置时迁移。
- 共享 Profile 采用同目录临时文件和原子重命名，权限在 Unix 上收紧为 `0600`。Desktop 写入会按 ID 和 `updatedAt` 合并磁盘新值，删除项显式传递，避免旧内存快照覆盖 CLI 更新。损坏、未知版本、未知字段或超过 100 个 Provider 时拒绝加载，不把错误文件静默替换。
- 删除 Desktop Provider 时同步删除共享 Profile 项和对应系统凭据；默认 Provider 变更在整个 Profile 列表中保持唯一。
- CLI 修改 Profile 使用相同 Schema、文件权限与原子写入；损坏/未知版本时不得静默覆盖。完整契约见 `docs/20-cli-product-and-technical-specification.md`。
- VS Code New Conversation 只清理扩展当前会话；Provider、Secret 和最后写入快照有独立生命周期。卸载/清理行为必须在 Marketplace 隐私说明中说明。
- VS Code/CLI Agent 异常退出只恢复可证明安全的状态；当前首版不自动续跑或重放写入/命令。

## 7. 导入导出

备份包建议使用 `.evir-backup`，包含 manifest、结构化数据、Skill、非敏感 MCP 配置和 Artifact 索引。API Key 默认不导出；用户明确选择时必须密码加密。
