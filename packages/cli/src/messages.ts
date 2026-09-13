/**
 * CLI-2 localization: help / doctor / approval copy in zh + en. Language is
 * `--lang` when given (zh|en), else the CLI process env (LANG startsWith zh),
 * else English. Keys stay stable; tests assert both locales.
 */

const en = {
  help: `Evir CLI {version}

Usage:
  evir configure --protocol <id> --base-url <url> --model <id> [--tool-calling]
  evir doctor [--json]
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
  nonInteractiveRefusal: "Refusing a write or command without an interactive terminal approval",
};

const zh: typeof en = {
  help: `Evir CLI {version}

用法:
  evir configure --protocol <id> --base-url <url> --model <id> [--tool-calling]
  evir doctor [--json]
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
  nonInteractiveRefusal: "无交互终端时拒绝执行写入或命令",
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
