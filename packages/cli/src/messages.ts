/**
 * CLI-2 localization: help / doctor / approval copy in zh + en. Language is
 * `--lang` when given (zh|en), else the CLI process env (LANG startsWith zh),
 * else English. Keys stay stable; tests assert both locales.
 */

const en = {
  help: `Evir CLI {version}

Usage:
  evir configure --protocol <id> --base-url <url> --model <id> [--tool-calling]
  evir doctor [--json] [--lang zh|en]
  evir ask [prompt]
  evir agent [task] [--workspace <path>] [--json] [--lang zh|en]
  evir config-path

Secrets:
  EVIR_API_KEY       Temporary Provider API key override (never written to config)
  EVIR_CONFIG_DIR    Optional configuration root override

Configure stores credentials in the operating system credential store shared with Evir Desktop. Ask has no autonomous workspace access. Agent requires a tool-capable model and explicit approval for every write and command.`,
  agentWorkspace: "Agent workspace: {workspace}",
  agentDisclosure: "Relevant workspace content may be sent to {host}.",
  approvalTitle: "Approval required",
  approvalAllowOnce: "Allow once? [y/N] ",
  agentStopped: "Agent stopped.",
  agentCompleted: "Agent completed.",
  agentFailed: "Agent failed: {error}",
  agentSummary:
    "Agent completed: {steps} steps · {toolCalls} tool calls · writes {writesOk} ok, {writesFailed} failed · {verified} · {elapsed}s",
  agentVerified: "verified",
  agentUnverified: "unverified",
  nonInteractiveRefusal: "Refusing a write or command without an interactive terminal approval",
  doctorLabelConfiguration: "configuration",
  doctorLabelProvider: "provider",
  doctorLabelApiKey: "api-key",
  doctorLabelNodeInPath: "node-in-path",
  doctorLabelWorkspaceBoundary: "workspace-boundary",
  doctorLabelProviderConnection: "provider-connection",
  doctorApiKeyAvailable: "available (decrypted from the OS credential store)",
  doctorApiKeyMissing: "missing — run `evir configure` or set EVIR_API_KEY",
  doctorNodeAvailable: "node {version}",
  doctorNodeMissing: "node not found in PATH — agent tooling needs it",
  doctorBoundaryOk: "{workspace} (agent writes stay inside it)",
  doctorBoundaryFail: "{error}",
  doctorConnectionOk: "connection succeeded",
  doctorConnectionFailed: "connection failed{error}",
  doctorConnectionSkipped: "skipped — no API key",
  configInvalid: "Invalid provider configuration in {path}: {issues}",
  configureInvalid: "Invalid configure values: {issues}",
  configureSavedTo: "Saved non-secret configuration to {path}",
  configureKeySaved: "Saved the API key in the operating system credential store.",
  configureKeyKept:
    "Kept the existing credential. Set EVIR_API_KEY to replace it non-interactively.",
  apiKeyNotSet: "EVIR_API_KEY is not set",
  promptRequired: "A prompt is required",
  agentRequiresToolCalling:
    "Agent requires toolCalling: true. Re-run configure with --tool-calling",
  hiddenApiKeyPrompt: "API key (hidden; leave blank to keep the existing credential): ",
  configureCancelled: "Configuration cancelled",
  notConfigured:
    "Evir is not configured. Run: evir configure --protocol ... --base-url ... --model ...",
};

const zh: typeof en = {
  help: `Evir CLI {version}

用法:
  evir configure --protocol <id> --base-url <url> --model <id> [--tool-calling]
  evir doctor [--json] [--lang zh|en]
  evir ask [提示词]
  evir agent [任务] [--workspace <路径>] [--json] [--lang zh|en]
  evir config-path

密钥:
  EVIR_API_KEY       临时 Provider API Key（不会写入配置）
  EVIR_CONFIG_DIR    可选配置根目录覆盖

configure 将凭据保存在与 Evir Desktop 共用的操作系统凭据库。Ask 无自主工作区访问。Agent 需要支持工具调用的模型，且每次写入与命令都需显式审批。`,
  agentWorkspace: "Agent 工作区：{workspace}",
  agentDisclosure: "相关工作区内容可能被发送到 {host}。",
  approvalTitle: "需要审批",
  approvalAllowOnce: "本次允许？[y/N] ",
  agentStopped: "Agent 已停止。",
  agentCompleted: "Agent 已完成。",
  agentFailed: "Agent 失败：{error}",
  agentSummary:
    "Agent 已完成：{steps} 步 · {toolCalls} 次工具调用 · 写入 {writesOk} 成功 {writesFailed} 失败 · {verified} · {elapsed}s",
  agentVerified: "验证通过",
  agentUnverified: "未验证",
  nonInteractiveRefusal: "无交互终端时拒绝执行写入或命令",
  doctorLabelConfiguration: "配置",
  doctorLabelProvider: "Provider",
  doctorLabelApiKey: "API Key",
  doctorLabelNodeInPath: "PATH 中的 Node",
  doctorLabelWorkspaceBoundary: "工作区边界",
  doctorLabelProviderConnection: "Provider 连接",
  doctorApiKeyAvailable: "可用（已从操作系统凭据库解密）",
  doctorApiKeyMissing: "缺失 — 请运行 `evir configure` 或设置 EVIR_API_KEY",
  doctorNodeAvailable: "node {version}",
  doctorNodeMissing: "在 PATH 中未找到 node — Agent 工具需要它",
  doctorBoundaryOk: "{workspace}（Agent 写入保持在此范围内）",
  doctorBoundaryFail: "{error}",
  doctorConnectionOk: "连接成功",
  doctorConnectionFailed: "连接失败{error}",
  doctorConnectionSkipped: "已跳过 — 无 API Key",
  configInvalid: "{path} 中的 Provider 配置无效：{issues}",
  configureInvalid: "configure 参数无效：{issues}",
  configureSavedTo: "已将非密钥配置保存到 {path}",
  configureKeySaved: "已将 API Key 保存到操作系统凭据库。",
  configureKeyKept: "已保留现有凭据。设置 EVIR_API_KEY 可非交互式替换。",
  apiKeyNotSet: "未设置 EVIR_API_KEY",
  promptRequired: "需要提示词",
  agentRequiresToolCalling:
    "Agent 需要 toolCalling: true。请使用 --tool-calling 重新运行 configure",
  hiddenApiKeyPrompt: "API Key（隐藏输入；留空以保留现有凭据）： ",
  configureCancelled: "配置已取消",
  notConfigured: "Evir 尚未配置。请运行：evir configure --protocol ... --base-url ... --model ...",
};

export type CliStrings = typeof en;

export function cliStrings(lang?: string): CliStrings {
  const choice = lang ?? process.env.LANG ?? process.env.LC_ALL ?? "";
  return choice.toLowerCase().startsWith("zh") ? zh : en;
}

/** Fill `{name}` placeholders in a message. */
export function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => values[key] ?? match);
}
