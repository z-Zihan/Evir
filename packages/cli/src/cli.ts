import { realpathSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { stdin, stdout, stderr } from "node:process";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { parseArguments } from "./arguments";
import { requestApproval } from "./approval";
import { envelopeEvent, runAgent, type AgentEvent } from "./agent";
import { formatConfigError } from "./config-errors";
import {
  confirmConfigureSummary,
  ConfigurePromptCancelled,
  configureFlagName,
  missingConfigureFields,
  promptMissingConfigureValues,
} from "./configure-prompt";
import { defaultConfigPath, NotConfiguredError, readConfig, writeConfig } from "./config-store";
import { getProviderCredential, setProviderCredential } from "./credential-store";
import { CliExitError, mapProviderErrorTypeToExitCode, toExitCode } from "./exit-codes";
import { streamProvider, testProvider } from "./provider-client";
import { ProviderErrorType } from "../../../src/core/providers/stream-events";
import { cliConfigSchema } from "./types";
import { resolveWorkspace } from "./workspace-boundary";
import { cliStrings, fill, type CliStrings } from "./messages";

const VERSION = "0.1.0";

/** docs/20 §6.2: exit code 3 (credential/auth) is the auth-family split point for the stderr hint. */
const AUTH_EXIT_CODE = 3;

/** Short, un-localized machine tags for `doctor`'s provider-connection detail line. */
const PROVIDER_ERROR_TAGS: Record<ProviderErrorType, string> = {
  [ProviderErrorType.AUTH_FAILED]: "auth",
  [ProviderErrorType.CORS_BLOCKED]: "cors",
  [ProviderErrorType.RATE_LIMITED]: "rate-limit",
  [ProviderErrorType.INSUFFICIENT_BALANCE]: "balance",
  [ProviderErrorType.MODEL_NOT_FOUND]: "model",
  [ProviderErrorType.CONTEXT_OVERFLOW]: "context",
  [ProviderErrorType.TOOL_CALL_UNSUPPORTED]: "tool-calling",
  [ProviderErrorType.VISION_UNSUPPORTED]: "vision",
  [ProviderErrorType.PROTOCOL_INCOMPATIBLE]: "protocol",
  [ProviderErrorType.NETWORK_ERROR]: "network",
  [ProviderErrorType.PROVIDER_ERROR]: "provider",
  [ProviderErrorType.CANCELLED]: "cancelled",
};

/** stderr-only fix-it line appended after a Provider error's unmodified message. */
function providerErrorHint(
  exitCode: number,
  retryable: boolean | undefined,
  strings: CliStrings,
): string {
  if (exitCode === AUTH_EXIT_CODE) return strings.providerErrorHintAuth;
  return retryable
    ? `${strings.providerErrorHintGeneric} ${strings.providerErrorHintRetryable}`
    : strings.providerErrorHintGeneric;
}

export async function main(argv = process.argv.slice(2)): Promise<number> {
  let strings: CliStrings = cliStrings();
  try {
    const command = parseArguments(argv);
    strings = cliStrings(
      command.command === "agent" || command.command === "doctor" ? command.lang : undefined,
    );
    if (command.command === "help") {
      stdout.write(fill(strings.help, { version: VERSION }));
      return 0;
    }
    if (command.command === "version") {
      stdout.write(`${VERSION}\n`);
      return 0;
    }
    if (command.command === "config-path") {
      stdout.write(`${defaultConfigPath()}\n`);
      return 0;
    }
    if (command.command === "configure") {
      const previous = await readConfig().catch((error: unknown) => {
        if (error instanceof NotConfiguredError) return undefined;
        throw error;
      });
      const missing = missingConfigureFields(previous, command.values);
      if (missing.length > 0) {
        if (stdin.isTTY) {
          try {
            Object.assign(
              command.values,
              await promptMissingConfigureValues(missing, strings, stdin, stderr),
            );
          } catch (error) {
            if (error instanceof ConfigurePromptCancelled) {
              throw new CliExitError(2, strings.configureCancelled);
            }
            throw error;
          }
        } else {
          throw new CliExitError(
            2,
            fill(strings.configureMissingArgs, {
              flags: missing.map(configureFlagName).join(", "),
            }),
          );
        }
      }
      const now = Date.now();
      let config;
      try {
        config = cliConfigSchema.parse({
          ...previous,
          ...command.values,
          id:
            previous?.id === "legacy-cli-default"
              ? crypto.randomUUID()
              : (previous?.id ?? crypto.randomUUID()),
          name: previous?.name ?? "Evir CLI",
          enabled: true,
          isDefault: true,
          createdAt: previous?.createdAt || now,
          updatedAt: now,
        });
      } catch (error) {
        if (error instanceof z.ZodError) {
          throw new CliExitError(
            2,
            fill(strings.configureInvalid, { issues: formatConfigError(error) }),
          );
        }
        throw error;
      }
      if (missing.length > 0 && stdin.isTTY) {
        let confirmed: boolean;
        try {
          confirmed = await confirmConfigureSummary(
            {
              protocolId: config.protocolId,
              baseUrl: config.baseUrl,
              modelId: config.modelId,
              apiKeyStatus:
                config.protocolId === "ollama-native"
                  ? "none-required"
                  : process.env.EVIR_API_KEY
                    ? "env-override"
                    : "will-prompt",
            },
            strings,
            stdin,
            stderr,
          );
        } catch (error) {
          if (error instanceof ConfigurePromptCancelled) {
            throw new CliExitError(2, strings.configureCancelled);
          }
          throw error;
        }
        if (!confirmed) throw new CliExitError(2, strings.configureCancelled);
      }
      const apiKey =
        config.protocolId === "ollama-native"
          ? ""
          : (process.env.EVIR_API_KEY ?? (stdin.isTTY ? await readHiddenApiKey(strings) : ""));
      if (apiKey) await setProviderCredential(config.id, apiKey);
      await writeConfig(config);
      stdout.write(`${fill(strings.configureSavedTo, { path: defaultConfigPath() })}\n`);
      stdout.write(`${apiKey ? strings.configureKeySaved : strings.configureKeyKept}\n`);
      return 0;
    }
    const config = await readConfig();
    const apiKey = await resolveApiKey(config.id, config.protocolId);
    if (command.command === "doctor") {
      return runDoctor(config, apiKey, command.json === true, strings);
    }
    if (!apiKey) throw new CliExitError(3, strings.apiKeyNotSet);
    const prompt = command.prompt ?? (await readStdinPrompt());
    if (!prompt.trim()) throw new CliExitError(2, strings.promptRequired);
    const controller = new AbortController();
    const stop = () => controller.abort();
    process.once("SIGINT", stop);
    try {
      if (command.command === "ask") {
        const result = await streamProvider({
          config,
          apiKey,
          messages: [{ role: "user", content: prompt }],
          signal: controller.signal,
          onDelta: (text) => stdout.write(text),
        });
        stdout.write("\n");
        if (result.error && !result.stopped) {
          if (result.errorKind === "config") throw new CliExitError(2, result.error);
          const code = result.errorType ? mapProviderErrorTypeToExitCode(result.errorType) : 4;
          const hint = providerErrorHint(code, result.retryable, strings);
          throw new CliExitError(code, `${result.error}\n${hint}`);
        }
        return result.stopped ? 130 : 0;
      }
      if (!config.toolCalling) throw new CliExitError(2, strings.agentRequiresToolCalling);
      let workspace: string;
      try {
        workspace = await resolveWorkspace(command.workspace);
      } catch (error) {
        throw new CliExitError(5, error instanceof Error ? error.message : String(error));
      }
      stderr.write(
        `${fill(strings.agentWorkspace, { workspace })}\n${fill(strings.agentDisclosure, { host: new URL(config.baseUrl).host })}\n`,
      );
      let completedEvent: Extract<AgentEvent, { type: "completed" }> | undefined;
      const result = await runAgent({
        config,
        apiKey,
        prompt,
        workspace,
        signal: controller.signal,
        onDelta: (text) => stdout.write(text),
        approve: (message) => requestApproval(message, undefined, undefined, strings),
        // CLI-2: JSONL events go to stderr; stdout stays the final answer.
        // docs/20 §6.1: wrap each event in a versioned envelope.
        onEvent: (event: AgentEvent) => {
          if (event.type === "completed") completedEvent = event;
          if (command.json) stderr.write(`${JSON.stringify(envelopeEvent(event))}\n`);
        },
      });
      stdout.write("\n");
      if (result.error && !controller.signal.aborted) {
        const code =
          result.errorKind === "runtime"
            ? 7
            : result.errorKind === "config"
              ? 2
              : result.errorType
                ? mapProviderErrorTypeToExitCode(result.errorType)
                : 4;
        const message =
          result.errorKind === "provider"
            ? `${result.error}\n${providerErrorHint(code, result.retryable, strings)}`
            : result.error;
        throw new CliExitError(code, message);
      }
      if (!controller.signal.aborted && !result.error && completedEvent) {
        const toolCallsTotal = Object.values(completedEvent.toolCalls).reduce(
          (sum, count) => sum + count,
          0,
        );
        stderr.write(
          `${fill(strings.agentSummary, {
            steps: String(completedEvent.steps),
            toolCalls: String(toolCallsTotal),
            writesOk: String(completedEvent.writes.ok),
            writesFailed: String(completedEvent.writes.failed),
            verified: completedEvent.verified ? strings.agentVerified : strings.agentUnverified,
            elapsed: (completedEvent.elapsedMs / 1000).toFixed(1),
          })}\n`,
        );
      }
      return controller.signal.aborted ? 130 : 0;
    } finally {
      process.removeListener("SIGINT", stop);
    }
  } catch (error) {
    const message =
      error instanceof CliExitError
        ? error.message
        : error instanceof z.ZodError
          ? fill(strings.configInvalid, {
              path: defaultConfigPath(),
              issues: formatConfigError(error),
            })
          : error instanceof NotConfiguredError
            ? strings.notConfigured
            : error instanceof Error
              ? error.message
              : "Unknown error";
    stderr.write(`evir: ${message}\n`);
    return toExitCode(error);
  }
}

interface DoctorCheck {
  name: string;
  status: "ok" | "fail";
  detail: string;
}

/**
 * CLI-1 doctor: key decryption, provider probe, workspace boundary, and node
 * availability in PATH. Exit codes are stable for scripting: 0 healthy,
 * 1 provider/environment failure, 2 configuration incomplete. `--json`
 * emits the machine view (with version); human output stays plain.
 */
const DOCTOR_LABELS: Record<string, (strings: CliStrings) => string> = {
  configuration: (strings) => strings.doctorLabelConfiguration,
  provider: (strings) => strings.doctorLabelProvider,
  "api-key": (strings) => strings.doctorLabelApiKey,
  "node-in-path": (strings) => strings.doctorLabelNodeInPath,
  "workspace-boundary": (strings) => strings.doctorLabelWorkspaceBoundary,
  "provider-connection": (strings) => strings.doctorLabelProviderConnection,
};

async function runDoctor(
  config: Awaited<ReturnType<typeof readConfig>>,
  apiKey: string | undefined,
  json: boolean,
  strings: CliStrings,
): Promise<number> {
  const checks: DoctorCheck[] = [
    {
      name: "configuration",
      status: "ok",
      detail: defaultConfigPath(),
    },
    {
      name: "provider",
      status: "ok",
      detail: `${config.name} · ${config.protocolId} · ${config.modelId}`,
    },
    {
      name: "api-key",
      status: apiKey ? "ok" : "fail",
      detail: apiKey ? strings.doctorApiKeyAvailable : strings.doctorApiKeyMissing,
    },
  ];

  const nodeProbe = spawnSync("node", ["--version"], { encoding: "utf8" });
  checks.push({
    name: "node-in-path",
    status: nodeProbe.status === 0 ? "ok" : "fail",
    detail:
      nodeProbe.status === 0
        ? fill(strings.doctorNodeAvailable, { version: (nodeProbe.stdout ?? "").trim() })
        : strings.doctorNodeMissing,
  });

  try {
    const workspace = await resolveWorkspace(process.cwd());
    checks.push({
      name: "workspace-boundary",
      status: "ok",
      detail: fill(strings.doctorBoundaryOk, { workspace }),
    });
  } catch (error) {
    checks.push({
      name: "workspace-boundary",
      status: "fail",
      detail: fill(strings.doctorBoundaryFail, {
        error: error instanceof Error ? error.message : "workspace unavailable",
      }),
    });
  }

  if (apiKey) {
    const result = await testProvider(config, apiKey);
    const tag = result.errorType ? ` [${PROVIDER_ERROR_TAGS[result.errorType]}]` : "";
    checks.push({
      name: "provider-connection",
      status: result.ok ? "ok" : "fail",
      detail: result.ok
        ? strings.doctorConnectionOk
        : fill(strings.doctorConnectionFailed, {
            error: result.error ? `: ${result.error}${tag}` : tag,
          }),
    });
  } else {
    checks.push({
      name: "provider-connection",
      status: "fail",
      detail: strings.doctorConnectionSkipped,
    });
  }

  if (json) {
    stdout.write(
      `${JSON.stringify({ version: VERSION, checks, healthy: checks.every((check) => check.status === "ok") }, null, 2)}\n`,
    );
  } else {
    for (const check of checks) {
      const label = DOCTOR_LABELS[check.name]?.(strings) ?? check.name;
      stdout.write(`${check.status === "ok" ? "✔" : "✖"} ${label}: ${check.detail}\n`);
    }
  }
  const failed = checks.filter((check) => check.status === "fail");
  if (failed.some((check) => check.name === "api-key")) return 2;
  return failed.length > 0 ? 1 : 0;
}

async function resolveApiKey(providerId: string, protocol: string): Promise<string | undefined> {
  if (protocol === "ollama-native") return process.env.EVIR_API_KEY ?? "local";
  return process.env.EVIR_API_KEY ?? (await getProviderCredential(providerId));
}

async function readHiddenApiKey(strings: CliStrings): Promise<string> {
  if (!stdin.isTTY || typeof stdin.setRawMode !== "function") return "";
  stderr.write(strings.hiddenApiKeyPrompt);
  stdin.setRawMode(true);
  stdin.resume();
  let value = "";
  try {
    for await (const chunk of stdin) {
      const text = String(chunk);
      for (const character of text) {
        if (character === "\r" || character === "\n") {
          stderr.write("\n");
          return value;
        }
        if (character === "\u0003") throw new Error(strings.configureCancelled);
        if (character === "\u007f" || character === "\b") value = value.slice(0, -1);
        else value += character;
      }
    }
    return value;
  } finally {
    stdin.setRawMode(false);
    stdin.pause();
  }
}

async function readStdinPrompt(): Promise<string> {
  if (stdin.isTTY) return "";
  stdin.setEncoding("utf8");
  let result = "";
  for await (const chunk of stdin) result += String(chunk);
  return result;
}

try {
  if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
    process.exitCode = await main();
  }
} catch {
  // Imported modules and invalid launch paths must not execute the CLI entrypoint.
}
