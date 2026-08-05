# Evir 本地日志与诊断系统

## 1. 目标

Evir 需要覆盖全系统的本地日志、审计、性能追踪和崩溃诊断，以便用户或开发者将诊断文件发送给他人，或在 GitHub Issue 中附加。

这不是远程“后门”。Evir 不应提供任何可绕过用户控制、远程读取本地日志或静默上传数据的入口。

正确形态是：

- 日志始终在用户本地生成。
- 用户可在设置或隐藏的开发者诊断入口开启更详细级别。
- 用户主动导出诊断包。
- 导出前预览、脱敏并确认。
- 用户手动发送给他人或附加到 GitHub Issue。

## 2. 日志与审计分离

### 2.1 Diagnostic Log

用于排查应用运行问题：

- 启动与关闭。
- Runtime/Adapter 初始化。
- Provider 请求生命周期。
- 流式事件统计。
- MCP/Sidecar 生命周期。
- Storage/迁移。
- 通知、快捷键、更新。
- 性能和错误。

### 2.2 Audit Log

用于解释 Agent 做了什么：

- Tool 名称、来源、风险等级。
- 参数的安全摘要。
- 审批和拒绝。
- 执行状态、耗时、退出码。
- 变更 Artifact、Diff、回滚。

Audit Log 属于产品数据，不能因为清理普通诊断日志而丢失必要审计记录。

### 2.3 Crash Report

- Panic / unhandled exception。
- Native crash 摘要。
- 最近事件环形缓冲。
- 版本、系统和模块状态。

崩溃恢复只读取必要状态，不自动执行未完成操作。

## 3. 日志级别

```text
trace  仅临时诊断，数据量大
debug  开发和详细故障排查
info   生命周期和关键状态
warn   可恢复异常和降级
error  失败但应用仍运行
fatal  导致模块或应用终止
```

正式版默认 `info`。用户可临时开启 `debug` 或 `trace`，建议自动在一个会话或 24 小时后恢复默认，避免长期占用空间和泄露风险。

## 4. 日志通道

- `app`
- `ui`
- `runtime`
- `provider`
- `stream`
- `agent`
- `context`
- `memory`
- `tool`
- `approval`
- `filesystem`
- `process`
- `git`
- `mcp`
- `skill`
- `computer-use`
- `storage`
- `artifact`
- `notification`
- `shortcut`
- `usage`
- `performance`
- `update`
- `security`

所有模块使用统一 `LoggerPort`，禁止各自随意写文本文件或只调用 `console.log`。

## 5. 文件格式与目录

推荐 JSON Lines，方便流式写入、检索和自动脱敏：

```json
{"timestamp":"...","level":"info","channel":"provider","event":"request.completed","runId":"...","durationMs":812,"requestId":"..."}
```

目录示例：

```text
EvirData/
└── logs/
    ├── app-2026-08-05.jsonl
    ├── audit-2026-08-05.jsonl
    ├── performance-2026-08-05.jsonl
    └── crash/
```

使用按大小和日期滚动：

- 单文件建议 10-20 MB。
- 默认总量预算 100 MB。
- 默认保留 14 天，可在设置中调整。
- 先压缩旧日志，再删除超过保留期的数据。
- 清理任务事件驱动或低频执行，禁止空闲高频扫描。

## 6. 统一事件结构

```ts
interface LogEvent {
  timestamp: string;
  level: "trace" | "debug" | "info" | "warn" | "error" | "fatal";
  channel: string;
  event: string;
  message?: string;
  appVersion: string;
  platform: string;
  sessionId: string;
  conversationId?: string;
  runId?: string;
  stepId?: string;
  toolCallId?: string;
  requestId?: string;
  durationMs?: number;
  data?: Record<string, unknown>;
}
```

所有异步链路传递相关 ID，以便从一次用户操作追踪到模型请求、工具执行、存储和 UI 结果。

## 7. 脱敏规则

任何日志级别默认禁止写入：

- API Key、Bearer Token、Cookie。
- Authorization Header。
- SSH 私钥和系统凭据。
- 完整环境变量。
- 用户完整 Prompt、会话正文和文件正文。
- Provider 原始请求体和响应体。
- 未经用户确认的本地绝对路径。

应自动识别并替换：

```text
sk-...                  → [REDACTED_API_KEY]
Authorization: Bearer   → [REDACTED_AUTH]
password / secret       → [REDACTED_SECRET]
用户目录                 → ~ 或哈希化路径
```

日志调用 API 优先接收结构化安全字段，而不是先记录原文再事后清洗。

## 8. 诊断模式

### 8.1 标准模式

默认开启。记录生命周期、错误、耗时、状态码、请求 ID 和安全摘要。

### 8.2 详细模式

用户主动开启。增加：

- Context Budget 变化。
- Tool Schema 选择。
- Provider 事件类型统计。
- MCP 原始错误码和进程状态。
- 更细性能阶段。

仍不记录密钥和正文。

### 8.3 原始协议捕获

仅开发者诊断，必须：

- 明确风险警告。
- 限时、单次会话。
- 默认关闭。
- 单独文件。
- 导出前二次确认。
- 尽可能只捕获 Schema 和字段形状；确需正文时由用户单独授权。

正式产品不得通过隐藏远程开关静默启用。

## 9. 性能设计

- 日志写入使用异步有界队列。
- 批量 flush，关键 fatal/audit 事件例外。
- 队列满时优先丢弃低级别重复 trace/debug，并记录丢弃计数。
- 不在 React State 中保存完整日志。
- 大日志直接写文件，查看器按页/窗口读取。
- 日志格式化不阻塞流式 Token 渲染。
- 默认日志开销目标：空闲 CPU 增量接近 0；常规任务 CPU/延迟增量 < 2%。

## 10. 诊断包

用户点击“导出诊断包”后生成：

```text
Evir-Diagnostics-<timestamp>.zip
├── manifest.json
├── system.json
├── app-config-redacted.json
├── provider-metadata.json
├── runtime-status.json
├── mcp-status.json
├── schema-versions.json
├── logs/
├── crash/
└── performance-summary.json
```

默认不包含：

- API Key。
- 完整聊天。
- 文件正文。
- 原始 Tool 输出。
- 环境变量。
- SSH 信息。

用户可以在导出向导中额外选择特定会话或 Tool 日志，并看到清晰风险提示。

## 11. GitHub 反馈流程

1. 用户在设置页选择“提交反馈”。
2. Evir 生成脱敏描述和可选诊断包。
3. 用户预览内容。
4. Evir 打开 GitHub Issue 预填页面。
5. 用户手动将诊断 ZIP 拖入 Issue 附件区域并提交。

Evir 不持有 GitHub Token，也不后台上传诊断包。

## 12. 设置与开发者入口

设置页提供：

- 当前日志级别。
- 打开日志目录。
- 导出诊断包。
- 清理日志。
- 保留天数和空间上限。
- 开启临时详细日志。

可提供隐藏的“开发者诊断”入口，例如连续点击版本号，但其作用仅是显示高级本地选项，不能绕过用户授权或建立远程访问。

## 13. 验收要求

- 全部核心模块通过统一 LoggerPort 记录关键事件。
- API Key 和 Authorization 不会出现在自动化日志测试样本中。
- 日志损坏、磁盘满或写入失败不会导致聊天/Agent 崩溃。
- 诊断包可在离线环境生成。
- 用户能够预览、取消、删除和清空。
- GitHub Issue 流程不需要 Evir 后端或 GitHub Token。
