# Evir Provider 与协议矩阵

> 本文定义产品目标和 Adapter 边界，不代表当前骨架已完成所有接入。厂商 API 会变化；实现时必须以官方文档和实际探测为准，并记录核验日期。

## 1. 设计原则

Evir 不为每个厂商复制一套完整聊天逻辑，而是拆成三层：

1. **Provider Preset**：名称、品牌、国内/国际区域、默认 Base URL、认证字段和帮助说明。
2. **Protocol Adapter**：消息、流式事件、工具调用、错误和用量协议。
3. **Model Profile**：具体模型的能力、上下文、参数和验证状态。

同一厂商可以暴露多个协议；同一协议也可以被多个厂商复用。

## 2. 必须支持的协议 Adapter

### P0：聊天 MVP 必须实现

| Adapter ID | 协议 | 主要用途 |
|---|---|---|
| `openai-responses` | OpenAI Responses API | 新式流式、工具、多模态、状态项 |
| `openai-chat-completions` | OpenAI Chat Completions | 广泛兼容的聊天与工具调用 |
| `anthropic-messages` | Anthropic Messages API | Claude 原生消息、流式和 tool_use |
| `gemini-interactions` | Gemini Interactions API | Gemini 新式 Agent/流式接口 |
| `gemini-generate-content` | Gemini GenerateContent | Gemini 通用兼容与存量模型 |
| `openai-compatible-responses` | 自定义 OpenAI Responses 兼容 | 第三方/本地兼容端点 |
| `openai-compatible-chat` | 自定义 OpenAI Chat 兼容 | 国内外大多数兼容平台 |
| `anthropic-compatible-messages` | 自定义 Anthropic Messages 兼容 | Claude Code 类兼容端点 |

### P1：企业与本地场景

| Adapter ID | 协议 | 限制 |
|---|---|---|
| `azure-openai-responses` | Azure OpenAI Responses | endpoint、deployment/model、API version、API key/Entra |
| `azure-openai-chat` | Azure OpenAI Chat Completions | 同上 |
| `aws-bedrock-converse` | Bedrock Converse/ConverseStream | AWS SigV4；Desktop 优先 |
| `vertex-gemini` | Vertex AI Gemini | OAuth/ADC/service account；Desktop 优先 |
| `ollama-native` | Ollama `/api/chat` 等 | NDJSON 流式、本地模型列表 |
| `mistral-native` | Mistral Chat/Conversations | 处理其原生事件和参数差异 |
| `cohere-chat-v2` | Cohere Chat v2 | 原生工具、流式和引用 |

### P2：后续扩展

- OpenAI Realtime / xAI Realtime / Gemini Live。
- 语音、图像、视频专用协议。
- 厂商 Batch、Files、Fine-tuning 等管理 API。
- 本地推理服务的模型下载和生命周期管理。

P2 不应阻塞文本聊天和 Desktop Agent MVP。

## 3. 认证方式

统一认证抽象必须支持：

- `bearer-api-key`
- `x-api-key`
- `api-key-header`
- `query-api-key`
- `oauth-bearer`
- `azure-entra`
- `aws-sigv4`
- `google-adc`
- `none-local`
- 自定义非敏感 Header + 安全凭据引用

Web 只启用适合浏览器保存和调用的认证方式。AWS SigV4、Google service account/ADC、Entra 等企业凭据默认只在 Desktop 支持。

## 4. 国际 Provider 预设

### 核心预设

- OpenAI
- Anthropic
- Google Gemini API
- Microsoft Azure OpenAI
- Google Vertex AI
- Amazon Bedrock
- xAI
- Mistral AI
- Cohere
- OpenRouter
- Groq
- Together AI
- Fireworks AI
- NVIDIA NIM
- Perplexity
- Hugging Face Inference Providers

### 本地与自托管预设

- Ollama
- LM Studio
- vLLM
- llama.cpp server
- LocalAI
- LiteLLM Proxy

### 推荐协议映射

| Provider | 首选协议 | 备用协议 |
|---|---|---|
| OpenAI | OpenAI Responses | Chat Completions |
| Anthropic | Anthropic Messages | 无 |
| Google Gemini API | Gemini Interactions | GenerateContent |
| Azure OpenAI | Azure Responses | Azure Chat |
| AWS Bedrock | Bedrock Converse | 厂商原生/Responses，按模型能力 |
| Vertex AI | Vertex Gemini | OpenAI compatibility（如官方端点支持时） |
| xAI | OpenAI Responses | OpenAI Chat compatible |
| Mistral | Mistral Native | OpenAI-compatible Chat |
| Cohere | Cohere Chat v2 | 无 |
| OpenRouter | OpenAI Responses | OpenAI Chat compatible |
| Groq | OpenAI-compatible Chat | Responses（按官方能力） |
| Together AI | OpenAI-compatible Chat | 无 |
| Ollama | Ollama Native | OpenAI-compatible Responses/Chat、Anthropic-compatible |
| LM Studio | OpenAI-compatible Responses/Chat | Anthropic-compatible/native REST |
| vLLM | OpenAI-compatible Chat/Responses | 无 |

## 5. 中国大陆 Provider 预设

首批预设：

- DeepSeek
- 阿里云百炼 / 通义千问
- 火山引擎方舟 / 豆包
- 腾讯混元 / TokenHub
- 百度智能云千帆
- 智谱 BigModel / GLM
- Moonshot / Kimi
- MiniMax
- SiliconFlow 硅基流动
- 阶跃星辰 StepFun
- 讯飞星火
- 零一万物 Yi

后续可按官方 API 稳定性增加华为云 MaaS/ModelArts、商汤日日新等企业预设。未做官方核验的厂商仍可通过自定义兼容端点使用，但不能在 UI 中宣称完整支持。

### 推荐协议映射

| Provider | 首选协议 | 备用协议/备注 |
|---|---|---|
| DeepSeek | OpenAI-compatible Chat | Anthropic-compatible；工具续轮需保留厂商状态 |
| 阿里云百炼 | OpenAI-compatible Responses | OpenAI-compatible Chat；区域 Endpoint |
| 火山方舟 | OpenAI-compatible Responses | Chat；部分 Coding 入口支持 Anthropic-compatible |
| 腾讯混元/TokenHub | OpenAI-compatible Chat | Anthropic-compatible；平台迁移需预留多个 Endpoint |
| 百度千帆 | OpenAI-compatible Responses | OpenAI-compatible Chat；部分 Agent API 单独处理 |
| 智谱 GLM | OpenAI-compatible Chat | Anthropic-compatible |
| Kimi | OpenAI-compatible Chat | 使用 `tools/tool_calls`，不依赖废弃 `functions` |
| MiniMax | Anthropic-compatible Messages | OpenAI-compatible Chat |
| SiliconFlow | OpenAI-compatible Chat | 模型能力逐个探测 |
| StepFun | OpenAI-compatible Chat | 部分 Coding 入口支持 Anthropic-compatible |
| 讯飞星火 | OpenAI-compatible Chat | 旧模型/助手可能使用原生 WebSocket，不纳入 P0 |
| 零一万物 Yi | OpenAI-compatible Chat | 手动模型 ID 兜底 |

## 6. Provider 添加流程

1. 选择国家/区域过滤，或搜索 Provider。
2. 选择 Provider Preset，自动选择推荐协议。
3. 用户可切换该 Provider 支持的其他协议。
4. 选择区域/站点；中国站和国际站的账号、Key、Endpoint 必须分开。
5. 填写认证信息；Desktop 写入安全存储，Web 默认仅内存保存。
6. 获取模型列表；失败时允许手动填写。
7. 执行连接和基础流式测试。
8. 展示模型能力和验证来源。
9. 用户保存后才可用于会话。

## 7. Model Profile 与能力置信度

```ts
interface ModelProfile {
  providerId: string;
  protocol: string;
  modelId: string;
  capabilities: {
    streaming: boolean;
    toolCalling: boolean;
    parallelToolCalling: boolean;
    vision: boolean;
    audioInput: boolean;
    structuredOutput: boolean;
    reasoning: boolean;
    usage: boolean;
    systemInstructions: boolean;
    maxContextTokens?: number;
    maxOutputTokens?: number;
  };
  capabilityEvidence: Record<string, "preset" | "metadata" | "probe" | "user-override">;
  verifiedAt?: number;
}
```

能力是模型级数据，不是 Provider 级常量。

## 8. 协议兼容不是完全等价

“OpenAI-compatible”仅表示部分接口形状兼容，不代表所有参数和行为一致。Adapter 必须处理：

- 不支持的参数被忽略或报错。
- `developer`、`system` 角色差异。
- `max_tokens`、`max_completion_tokens` 等字段差异。
- 流式工具参数分片方式。
- reasoning/thinking 字段的保存和续轮规则。
- tool call ID、并行调用和 finish reason 差异。
- 图片和文件内容格式。
- JSON Schema 支持程度。
- usage 出现位置和缓存 Token 字段。
- 模型列表、错误对象和 request ID 差异。

不得只更换 Base URL 就宣称“完整兼容”。

## 9. 统一内部流式事件

所有 Adapter 转换为：

```ts
type ProviderStreamEvent =
  | { type: "response-start"; responseId?: string }
  | { type: "text-delta"; text: string }
  | { type: "tool-call-start"; callId: string; name: string }
  | { type: "tool-call-arguments-delta"; callId: string; delta: string }
  | { type: "tool-call-end"; callId: string }
  | { type: "usage"; inputTokens?: number; outputTokens?: number; cachedTokens?: number }
  | { type: "provider-state"; opaque: unknown }
  | { type: "response-complete"; finishReason?: string }
  | { type: "error"; code: string; message: string; retryable: boolean };
```

`provider-state` 只供 Adapter 续轮使用，必须脱敏、限制大小，不直接展示。

## 10. Web 与 Desktop 支持边界

### Web

- API Key/Bearer 类认证。
- 目标 Endpoint 必须允许浏览器 CORS。
- 不支持 AWS SigV4、service account 文件、ADC 和本地进程认证。
- 本地 `localhost` Provider 是否可用取决于浏览器混合内容、CORS 和用户配置。

### Desktop

- 支持全部协议 Adapter 和安全凭据存储。
- 可使用企业认证、区域 Endpoint、本地模型服务和代理设置。
- 网络请求仍受 Network Policy 管理。

## 11. 服务端工具

Provider 自带搜索、代码执行、文件搜索、远程 MCP 等工具不得与 Evir 本地工具混合显示。

- 默认关闭。
- 单独展示执行方和数据去向。
- 启用前确认费用、隐私和网络访问。
- 不允许 Provider 服务端工具绕过 Evir 本地权限系统去访问本地文件。

## 12. 测试矩阵

每个 Protocol Adapter 至少测试：

- 非流式文本。
- 流式文本与取消。
- 多轮上下文。
- 工具调用及流式参数拼接。
- 工具结果续轮。
- 错误映射。
- 用量解析。
- 不支持能力时的降级。
- 超时、断线和部分结果保存。

Provider Preset 测试不需要覆盖所有模型，但每个协议至少要有一个官方 Provider 和一个兼容 Provider 的契约测试。

## 13. 官方资料核验基线（2026-08）

实现时优先查阅各厂商官方开发文档。当前调研确认：OpenAI、Azure OpenAI、Gemini、Bedrock、xAI、Ollama、OpenRouter、Groq、Together AI，以及 DeepSeek、百炼、方舟、混元、千帆、智谱、Kimi、MiniMax、SiliconFlow、StepFun 和讯飞均提供流式或兼容接口；具体工具、多模态和参数支持必须按模型核验。

## 官方链接要求

Provider Preset 除 API Endpoint 外还应维护 `officialLinks`：官网、控制台、开发文档和可选状态页。它们只用于帮助用户获取 Key、查看文档和排错。代码清单见 `src/core/providers/provider-links.ts`。
