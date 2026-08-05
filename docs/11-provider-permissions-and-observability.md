# Evir Provider、权限与可观测性规范

## 1. 三层模型

Provider 接入必须拆成：

- Provider Preset：厂商、区域、默认 Endpoint、认证表单。
- Protocol Adapter：消息、流式、工具、错误和 usage 协议。
- Model Profile：具体模型能力与验证证据。

不得在 UI 或业务逻辑中按厂商名称分支请求。完整矩阵见 `docs/13-provider-and-protocol-matrix.md`。

## 2. Provider 添加闭环

1. 搜索或按国内、国际、本地、自定义筛选。
2. 选择 Provider 与区域/站点。
3. 自动选择推荐协议，允许在官方支持范围内切换。
4. 填写认证信息和 Endpoint。
5. 获取模型列表，失败时允许手动模型 ID。
6. 进行无副作用连接与真实流式测试。
7. 用户确认后再执行可能产生费用的 Tool Calling、Vision、Structured Output 探测。
8. 展示能力、证据和核验时间。
9. 保存并选择默认模型。

Web 遇到 CORS 时必须明确说明无法浏览器直连，不得使用隐藏代理。

## 3. Provider 能力矩阵

至少记录：streaming、toolCalling、parallelToolCalling、vision、audioInput、structuredOutput、reasoning、systemInstructions、usage、maxContextTokens 和 maxOutputTokens。

Agent 模式要求当前模型支持 Tool Calling。能力证据为：

- `preset`
- `metadata`
- `probe`
- `user-override`

用户覆盖必须显示“未经验证”。

## 4. 协议兼容性

“OpenAI-compatible”不是完整等价。Adapter 必须处理角色、参数名、流式分片、工具参数拼接、reasoning/thinking 状态、图片格式、错误对象、usage 和 finish reason 差异。

厂商特定 reasoning/thinking 状态可作为 opaque provider state 保存并用于续轮，但不得作为模型私有推理链展示。

## 5. 错误分类

至少区分：

- `AUTH_FAILED`
- `CORS_BLOCKED`
- `RATE_LIMITED`
- `INSUFFICIENT_BALANCE`
- `MODEL_NOT_FOUND`
- `CONTEXT_OVERFLOW`
- `TOOL_CALL_UNSUPPORTED`
- `VISION_UNSUPPORTED`
- `PROTOCOL_INCOMPATIBLE`
- `NETWORK_ERROR`
- `PROVIDER_ERROR`
- `CANCELLED`

每类错误提供明确下一步。不得统一显示“请求失败”。

## 6. 运行模式

- Ask：不自主调用本地工具。
- Plan：只读工具可用，禁止状态变更。
- Agent：按权限策略执行。

Tool Registry 必须基于 Runtime Capability、Mode、Workspace Permission、Network Policy 和 Model Capability 共同计算。

## 7. 权限和网络

提供安全、标准、自动和自定义预设。任何模式下，删除、发布、提权、敏感目录、读取密钥、上传本地内容仍需确认或禁止。

Network Policy 分别控制：

- 模型 Provider
- 网页读取
- 包管理器
- Git Remote
- 远程 MCP
- Provider 服务端工具
- 本地文件外发

“访问网络”和“上传本地内容”必须是两个独立权限。

## 8. 工具来源

审计与 UI 必须标记：

- `evir-local`
- `mcp-local`
- `mcp-remote`
- `provider-server`

Provider 服务端工具默认关闭，不得通过厂商工具绕过本地权限。

## 9. Skill 与 MCP 可观测性

记录 Skill 激活原因、版本、激活方式和应用规则；MCP 页面提供连接测试、能力查看、Schema、手动调用、原始返回、日志、PID、重启和超时。第三方描述和返回值不可信。

## 10. 用量与费用

保存并展示 Provider 返回的输入、输出、缓存和工具 Token。只有价格元数据可靠时才估算费用并标记为估算。能力探测、重试和工具续轮均计入。

默认不自动跨 Provider 回退。未来如支持，必须显式配置候选 Provider 和数据去向。

## 11. 诊断包

诊断包包含 Evir/系统版本、Runtime、Provider/协议类型、模型 ID、MCP 状态、本地 Schema 版本、性能指标、request ID 和脱敏错误；不包含 API Key、完整对话、用户文件正文、环境变量和 SSH 信息。

## 12. Provider 官方入口

每个内置 Preset 应提供官网、控制台、文档和可选状态页。官方链接与 API Endpoint 分离：点击链接不会修改配置，API 请求也不得从官网 URL 推导 Endpoint。用户添加自定义 Provider 时可自行填写帮助链接，但必须标记为用户提供。

## 13. 模型中途切换可观测性

记录切换来源/目标 Provider、Model、Protocol、触发时间、上下文利用率、能力差异、是否跨数据目的地、Handoff 版本、确认结果和失败原因。不得记录 API Key 或私有 reasoning 内容。

切换时的默认动作：空闲立即切换；流式响应下一轮生效或用户停止；工具执行等待安全边界；跨 Provider 明确提示数据去向；目标不支持 Tool Calling 时阻止 Agent 续跑。

## 14. 全系统日志

Diagnostic、Audit、Crash 三类数据分离。Provider 日志记录 request ID、状态码、事件类型、首 Token 和总耗时，不记录完整请求正文。Tool Audit 记录安全参数摘要、审批、退出码和 Artifact。日志导出前必须脱敏与预览。

正式版不存在远程日志后门。隐藏开发者入口只能开启本地详细日志和导出功能。完整规范见 `docs/17-local-logging-and-diagnostics.md`。
