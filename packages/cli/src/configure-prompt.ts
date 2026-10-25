import type { Readable, Writable } from "node:stream";
import { fill, type CliStrings } from "./messages";
import { protocolSchema } from "./types";

/** The three `configure` flags required before `cliConfigSchema.parse` can run. */
export type ConfigureField = "protocolId" | "baseUrl" | "modelId";

const CONFIGURE_FLAG_NAMES: Record<ConfigureField, string> = {
  protocolId: "--protocol",
  baseUrl: "--base-url",
  modelId: "--model",
};

export function configureFlagName(field: ConfigureField): string {
  return CONFIGURE_FLAG_NAMES[field];
}

/** Thrown when the user cancels an interactive prompt (Ctrl+C or EOF). */
export class ConfigurePromptCancelled extends Error {
  constructor() {
    super("Configuration prompt cancelled");
    this.name = "ConfigurePromptCancelled";
  }
}

interface ConfigureValues {
  protocolId?: string;
  baseUrl?: string;
  modelId?: string;
}

/** Fields still missing after merging stored config with this invocation's flags. */
export function missingConfigureFields(
  previous: ConfigureValues | undefined,
  values: ConfigureValues,
): ConfigureField[] {
  const missing: ConfigureField[] = [];
  if (!previous?.protocolId && !values.protocolId) missing.push("protocolId");
  if (!previous?.baseUrl && !values.baseUrl) missing.push("baseUrl");
  if (!previous?.modelId && !values.modelId) missing.push("modelId");
  return missing;
}

/**
 * Reads newline-terminated answers off a shared async iterator so multiple
 * sequential prompts can read from the same stream. A plain `for await`
 * loop would call the iterator's `return()` (and destroy the stream) the
 * moment the first prompt's loop body returns, breaking every prompt after
 * it — so `next()` is driven by hand instead.
 */
class LineReader {
  private readonly iterator: AsyncIterator<unknown>;
  private buffer = "";
  private ended = false;

  constructor(input: Readable) {
    this.iterator = (input as AsyncIterable<unknown>)[Symbol.asyncIterator]();
  }

  async readLine(): Promise<string> {
    for (;;) {
      if (this.buffer.includes("\u0003")) throw new ConfigurePromptCancelled();
      const newlineIndex = this.buffer.search(/[\r\n]/);
      if (newlineIndex !== -1) {
        const line = this.buffer.slice(0, newlineIndex);
        let consumed = newlineIndex + 1;
        if (this.buffer[newlineIndex] === "\r" && this.buffer[consumed] === "\n") consumed += 1;
        this.buffer = this.buffer.slice(consumed);
        return line;
      }
      if (this.ended) throw new ConfigurePromptCancelled();
      const result = await this.iterator.next();
      if (result.done) {
        this.ended = true;
        continue;
      }
      this.buffer += String(result.value);
    }
  }
}

function isValidUrl(value: string): boolean {
  try {
    return Boolean(new URL(value));
  } catch {
    return false;
  }
}

const BASE_URL_MAX_RETRIES = 2;

/**
 * docs/20 §4.1 step 2 wizard, first increment: prompts for exactly the
 * fields listed in `missing`, in order, over an already-open TTY stdin.
 * Blank answers abandon that field (the caller's later Zod parse then
 * reports it as missing); an invalid base URL is retried up to twice
 * before being passed through as-is so Zod reports the format error.
 */
export async function promptMissingConfigureValues(
  missing: ConfigureField[],
  strings: CliStrings,
  input: Readable,
  output: Writable,
): Promise<ConfigureValues> {
  const reader = new LineReader(input);
  const result: ConfigureValues = {};
  for (const field of missing) {
    if (field === "protocolId") {
      output.write(
        fill(strings.configurePromptProtocol, { protocols: protocolSchema.options.join(" / ") }),
      );
      const answer = (await reader.readLine()).trim();
      if (answer) result.protocolId = answer;
    } else if (field === "modelId") {
      output.write(strings.configurePromptModel);
      const answer = (await reader.readLine()).trim();
      if (answer) result.modelId = answer;
    } else {
      output.write(strings.configurePromptBaseUrl);
      let answer = (await reader.readLine()).trim();
      let attempts = 0;
      while (answer && !isValidUrl(answer) && attempts < BASE_URL_MAX_RETRIES) {
        attempts += 1;
        output.write(strings.configurePromptRetryBaseUrl);
        answer = (await reader.readLine()).trim();
      }
      if (answer) result.baseUrl = answer;
    }
  }
  return result;
}
