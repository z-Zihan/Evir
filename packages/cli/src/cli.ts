import { realpathSync } from "node:fs";
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

const VERSION = "0.1.0";

export async function main(argv = process.argv.slice(2)): Promise<number> {
  try {
    const command = parseArguments(argv);
    if (command.command === "help") {
      stdout.write(help());
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
      stdout.write(
        `Configuration: ${defaultConfigPath()}\nProvider: ${config.name}\nProtocol: ${config.protocolId}\nModel: ${config.modelId}\nAPI key: ${apiKey ? "available" : "missing"}\n`,
      );
      if (!apiKey) return 2;
      const result = await testProvider(config, apiKey);
      stdout.write(`Provider: ${result.ok ? "ok" : `failed: ${result.error}`}\n`);
      return result.ok ? 0 : 1;
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
        `Agent workspace: ${workspace}\nRelevant workspace content may be sent to ${new URL(config.baseUrl).host}.\n`,
      );
      const result = await runAgent({
        config,
        apiKey,
        prompt,
        workspace,
        signal: controller.signal,
        onDelta: (text) => stdout.write(text),
        approve: (message) => requestApproval(message),
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

function help(): string {
  return `Evir CLI ${VERSION}\n\nUsage:\n  evir configure --protocol <id> --base-url <url> --model <id> [--tool-calling]\n  evir doctor\n  evir ask [prompt]\n  evir agent [task] [--workspace <path>]\n  evir config-path\n\nSecrets:\n  EVIR_API_KEY       Temporary Provider API key override (never written to config)\n  EVIR_CONFIG_DIR    Optional configuration root override\n\nConfigure stores credentials in the operating system credential store shared with Evir Desktop. Ask has no autonomous workspace access. Agent requires a tool-capable model and explicit approval for every write and command.\n`;
}

try {
  if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
    process.exitCode = await main();
  }
} catch {
  // Imported modules and invalid launch paths must not execute the CLI entrypoint.
}
