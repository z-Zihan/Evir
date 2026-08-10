import type { ParsedCommand } from "./types";

export function parseArguments(argv: string[]): ParsedCommand {
  const [command, ...rest] = argv;
  if (!command || command === "help" || command === "--help" || command === "-h") {
    return { command: "help" };
  }
  if (command === "--version" || command === "-v" || command === "version") {
    return { command: "version" };
  }
  if (command === "doctor") return { command: "doctor" };
  if (command === "config-path") return { command: "config-path" };
  if (command === "configure") {
    const flags = parseFlags(rest);
    const protocolId = stringFlag(flags, "protocol");
    const baseUrl = stringFlag(flags, "base-url");
    const modelId = stringFlag(flags, "model");
    return {
      command: "configure",
      values: {
        ...(protocolId ? { protocolId } : {}),
        ...(baseUrl ? { baseUrl } : {}),
        ...(modelId ? { modelId } : {}),
        ...(flags.has("tool-calling") ? { toolCalling: true } : {}),
        ...(flags.has("no-tool-calling") ? { toolCalling: false } : {}),
      },
    };
  }
  if (command === "ask") {
    const prompt = positional(rest).join(" ");
    return { command: "ask", ...(prompt ? { prompt } : {}) };
  }
  if (command === "agent") {
    const flags = parseFlags(rest);
    return {
      command: "agent",
      ...(positional(rest).join(" ") ? { prompt: positional(rest).join(" ") } : {}),
      workspace: stringFlag(flags, "workspace") ?? process.cwd(),
    };
  }
  throw new Error(`Unknown command: ${command}`);
}

function parseFlags(values: string[]): Map<string, string | true> {
  const flags = new Map<string, string | true>();
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!value?.startsWith("--")) continue;
    const name = value.slice(2);
    const next = values[index + 1];
    if (next && !next.startsWith("--")) {
      flags.set(name, next);
      index += 1;
    } else flags.set(name, true);
  }
  return flags;
}

function stringFlag(flags: Map<string, string | true>, name: string): string | undefined {
  const value = flags.get(name);
  return typeof value === "string" ? value : undefined;
}

function positional(values: string[]): string[] {
  const result: string[] = [];
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!value) continue;
    if (value.startsWith("--")) {
      if (values[index + 1] && !values[index + 1]?.startsWith("--")) index += 1;
    } else result.push(value);
  }
  return result;
}
