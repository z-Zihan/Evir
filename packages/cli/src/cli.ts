import { realpathSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { stdin, stdout, stderr } from "node:process";
import { fileURLToPath } from "node:url";
import { parseArguments } from "./arguments";
import { requestApproval } from "./approval";
import { runAgent } from "./agent";
import { defaultConfigPath, readConfig, writeConfig } from "./config-store";
import { getProviderCredential, setProviderCredential } from "./credential-store";
import { streamProvider, testProvider } from "./provider-client";
import { cliConfigSchema } from "./types";
import { resolveWorkspace } from "./workspace-boundary";
import { cliStrings, fill } from "./messages";

const VERSION = "0.1.0";

export async function main(argv = process.argv.slice(2)): Promise<number> {
  try {
    const command = parseArguments(argv);
    const strings = cliStrings(command.command === "agent" ? command.lang : undefined);
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
        if (error instanceof Error && error.message.startsWith("Evir is not configured.")) {
          return undefined;
        }
        throw error;
      });
      const now = Date.now();
      const config = cliConfigSchema.parse({
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
      const apiKey =
        config.protocolId === "ollama-native"
          ? ""
          : (process.env.EVIR_API_KEY ?? (stdin.isTTY ? await readHiddenApiKey() : ""));
      if (apiKey) await setProviderCredential(config.id, apiKey);
      await writeConfig(config);
      stdout.write(`Saved non-secret configuration to ${defaultConfigPath()}\n`);
      stdout.write(
        apiKey
          ? "Saved the API key in the operating system credential store.\n"
          : "Kept the existing credential. Set EVIR_API_KEY to replace it non-interactively.\n",
      );
      return 0;
    }
    const config = await readConfig();
    const apiKey = await resolveApiKey(config.id, config.protocolId);
    if (command.command === "doctor") {
      return runDoctor(config, apiKey, command.json === true);
    }
    if (!apiKey) throw new Error("EVIR_API_KEY is not set");
    const prompt = command.prompt ?? (await readStdinPrompt());
    if (!prompt.trim()) throw new Error("A prompt is required");
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
        if (result.error && !result.stopped) throw new Error(result.error);
        return result.stopped ? 130 : 0;
      }
      if (!config.toolCalling)
        throw new Error("Agent requires toolCalling: true. Re-run configure with --tool-calling");
      const workspace = await resolveWorkspace(command.workspace);
      stderr.write(
        `${fill(strings.agentWorkspace, { workspace })}\n${fill(strings.agentDisclosure, { host: new URL(config.baseUrl).host })}\n`,
      );
      const result = await runAgent({
        config,
        apiKey,
        prompt,
        workspace,
        signal: controller.signal,
        onDelta: (text) => stdout.write(text),
        approve: (message) => requestApproval(message, undefined, undefined, strings),
        // CLI-2: JSONL events go to stderr; stdout stays the final answer.
        ...(command.json
          ? {
              onEvent: (event: import("./agent").AgentEvent) => {
                stderr.write(`${JSON.stringify(event)}\n`);
              },
            }
          : {}),
      });
      stdout.write("\n");
      if (result.error && !controller.signal.aborted) throw new Error(result.error);
      return controller.signal.aborted ? 130 : 0;
    } finally {
      process.removeListener("SIGINT", stop);
    }
  } catch (error) {
    stderr.write(`evir: ${error instanceof Error ? error.message : "Unknown error"}\n`);
    return 1;
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
async function runDoctor(
  config: Awaited<ReturnType<typeof readConfig>>,
  apiKey: string | undefined,
  json: boolean,
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
      detail: apiKey
        ? "available (decrypted from the OS credential store)"
        : "missing — run `evir configure` or set EVIR_API_KEY",
    },
  ];

  const nodeProbe = spawnSync("node", ["--version"], { encoding: "utf8" });
  checks.push({
    name: "node-in-path",
    status: nodeProbe.status === 0 ? "ok" : "fail",
    detail:
      nodeProbe.status === 0
        ? `node ${(nodeProbe.stdout ?? "").trim()}`
        : "node not found in PATH — agent tooling needs it",
  });

  try {
    const workspace = await resolveWorkspace(process.cwd());
    checks.push({
      name: "workspace-boundary",
      status: "ok",
      detail: `${workspace} (agent writes stay inside it)`,
    });
  } catch (error) {
    checks.push({
      name: "workspace-boundary",
      status: "fail",
      detail: error instanceof Error ? error.message : "workspace unavailable",
    });
  }

  if (apiKey) {
    const result = await testProvider(config, apiKey);
    checks.push({
      name: "provider-connection",
      status: result.ok ? "ok" : "fail",
      detail: result.ok ? "connection succeeded" : (result.error ?? "connection failed"),
    });
  } else {
    checks.push({
      name: "provider-connection",
      status: "fail",
      detail: "skipped — no API key",
    });
  }

  if (json) {
    stdout.write(
      `${JSON.stringify({ version: VERSION, checks, healthy: checks.every((check) => check.status === "ok") }, null, 2)}\n`,
    );
  } else {
    for (const check of checks) {
      stdout.write(`${check.status === "ok" ? "✔" : "✖"} ${check.name}: ${check.detail}\n`);
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

async function readHiddenApiKey(): Promise<string> {
  if (!stdin.isTTY || typeof stdin.setRawMode !== "function") return "";
  stderr.write("API key (hidden; leave blank to keep the existing credential): ");
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
        if (character === "\u0003") throw new Error("Configuration cancelled");
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
