import type { ProviderOfficialLinks } from "./types";

/**
 * Official public links shown in the provider setup UI.
 * These links are metadata only and must never be used as API endpoints.
 */
export const PROVIDER_OFFICIAL_LINKS = {
  openai: {
    website: "https://openai.com/",
    console: "https://platform.openai.com/",
    docs: "https://platform.openai.com/docs/",
    status: "https://status.openai.com/",
  },
  anthropic: {
    website: "https://www.anthropic.com/",
    console: "https://console.anthropic.com/",
    docs: "https://docs.anthropic.com/",
    status: "https://status.anthropic.com/",
  },
  "google-gemini": {
    website: "https://ai.google.dev/",
    console: "https://aistudio.google.com/",
    docs: "https://ai.google.dev/gemini-api/docs/",
    status: "https://status.cloud.google.com/",
  },
  "azure-openai": {
    website: "https://azure.microsoft.com/products/ai-services/openai-service/",
    console: "https://portal.azure.com/",
    docs: "https://learn.microsoft.com/azure/ai-services/openai/",
    status: "https://status.azure.com/",
  },
  "aws-bedrock": {
    website: "https://aws.amazon.com/bedrock/",
    console: "https://console.aws.amazon.com/bedrock/",
    docs: "https://docs.aws.amazon.com/bedrock/",
    status: "https://health.aws.amazon.com/health/status/",
  },
  xai: {
    website: "https://x.ai/",
    console: "https://console.x.ai/",
    docs: "https://docs.x.ai/",
    status: "https://status.x.ai/",
  },
  openrouter: {
    website: "https://openrouter.ai/",
    console: "https://openrouter.ai/settings/keys",
    docs: "https://openrouter.ai/docs/",
    status: "https://status.openrouter.ai/",
  },
  groq: {
    website: "https://groq.com/",
    console: "https://console.groq.com/",
    docs: "https://console.groq.com/docs/",
    status: "https://groqstatus.com/",
  },
  together: {
    website: "https://www.together.ai/",
    console: "https://api.together.ai/",
    docs: "https://docs.together.ai/",
  },
  mistral: {
    website: "https://mistral.ai/",
    console: "https://console.mistral.ai/",
    docs: "https://docs.mistral.ai/",
    status: "https://status.mistral.ai/",
  },
  "google-vertex-ai": {
    website: "https://cloud.google.com/vertex-ai/generative-ai/",
    console: "https://console.cloud.google.com/vertex-ai/",
    docs: "https://cloud.google.com/vertex-ai/generative-ai/docs/",
    status: "https://status.cloud.google.com/",
  },
  cohere: {
    website: "https://cohere.com/",
    console: "https://dashboard.cohere.com/",
    docs: "https://docs.cohere.com/",
    status: "https://status.cohere.com/",
  },
  fireworks: {
    website: "https://fireworks.ai/",
    console: "https://app.fireworks.ai/",
    docs: "https://docs.fireworks.ai/",
  },
  "nvidia-nim": {
    website: "https://www.nvidia.com/en-us/ai/",
    console: "https://build.nvidia.com/",
    docs: "https://docs.nvidia.com/nim/",
    status: "https://status.nvidia.com/",
  },
  perplexity: {
    website: "https://www.perplexity.ai/",
    console: "https://www.perplexity.ai/settings/api",
    docs: "https://docs.perplexity.ai/",
    status: "https://status.perplexity.com/",
  },
  "hugging-face": {
    website: "https://huggingface.co/",
    console: "https://huggingface.co/settings/tokens",
    docs: "https://huggingface.co/docs/inference-providers/",
    status: "https://status.huggingface.co/",
  },
  deepseek: {
    website: "https://www.deepseek.com/",
    console: "https://platform.deepseek.com/",
    docs: "https://api-docs.deepseek.com/",
    status: "https://status.deepseek.com/",
  },
  "alibaba-model-studio": {
    website: "https://www.aliyun.com/product/bailian/",
    console: "https://bailian.console.aliyun.com/",
    docs: "https://help.aliyun.com/zh/model-studio/",
    status: "https://status.aliyun.com/",
  },
  "volcengine-ark": {
    website: "https://www.volcengine.com/product/ark/",
    console: "https://console.volcengine.com/ark/",
    docs: "https://www.volcengine.com/docs/82379/",
  },
  "tencent-hunyuan": {
    website: "https://cloud.tencent.com/product/hunyuan/",
    console: "https://console.cloud.tencent.com/hunyuan/",
    docs: "https://cloud.tencent.com/document/product/1729/",
    status: "https://status.cloud.tencent.com/",
  },
  "baidu-qianfan": {
    website: "https://cloud.baidu.com/product/wenxinworkshop/",
    console: "https://console.bce.baidu.com/qianfan/",
    docs: "https://cloud.baidu.com/doc/WENXINWORKSHOP/",
  },
  zhipu: {
    website: "https://www.bigmodel.cn/",
    console: "https://open.bigmodel.cn/",
    docs: "https://docs.bigmodel.cn/",
  },
  "moonshot-kimi": {
    website: "https://www.moonshot.cn/",
    console: "https://platform.moonshot.cn/",
    docs: "https://platform.moonshot.cn/docs/",
    status: "https://status.moonshot.cn/",
  },
  minimax: {
    website: "https://www.minimaxi.com/",
    console: "https://platform.minimaxi.com/",
    docs: "https://platform.minimaxi.com/document/",
  },
  siliconflow: {
    website: "https://siliconflow.cn/",
    console: "https://cloud.siliconflow.cn/",
    docs: "https://docs.siliconflow.cn/",
    status: "https://status.siliconflow.cn/",
  },
  stepfun: {
    website: "https://www.stepfun.com/",
    console: "https://platform.stepfun.com/",
    docs: "https://platform.stepfun.com/docs/",
  },
  "iflytek-spark": {
    website: "https://xinghuo.xfyun.cn/",
    console: "https://console.xfyun.cn/",
    docs: "https://www.xfyun.cn/doc/spark/",
  },
  yi: {
    website: "https://www.lingyiwanwu.com/",
    console: "https://platform.lingyiwanwu.com/",
    docs: "https://platform.lingyiwanwu.com/docs/",
  },
  ollama: {
    website: "https://ollama.com/",
    docs: "https://docs.ollama.com/",
  },
  "lm-studio": {
    website: "https://lmstudio.ai/",
    docs: "https://lmstudio.ai/docs/",
  },
  vllm: {
    website: "https://vllm.ai/",
    docs: "https://docs.vllm.ai/",
  },
  "llama-cpp": {
    website: "https://github.com/ggml-org/llama.cpp/",
    docs: "https://github.com/ggml-org/llama.cpp/tree/master/examples/server/",
  },
  localai: {
    website: "https://localai.io/",
    docs: "https://localai.io/docs/",
  },
  litellm: {
    website: "https://www.litellm.ai/",
    console: "https://docs.litellm.ai/docs/proxy/ui/",
    docs: "https://docs.litellm.ai/",
  },
} as const satisfies Record<string, ProviderOfficialLinks>;
