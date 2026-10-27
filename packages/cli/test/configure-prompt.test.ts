import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import {
  ConfigurePromptCancelled,
  configureFlagName,
  confirmConfigureSummary,
  LineReader,
  missingConfigureFields,
  promptMissingConfigureValues,
} from "../src/configure-prompt";
import { cliStrings } from "../src/messages";

/**
 * configure 第一步：非 TTY 明确报错所需的缺失字段判定，以及 TTY 下
 * promptMissingConfigureValues 的交互式补全（见 docs/20 §4.1/§12）。
 */

function sendLines(lines: string[]): PassThrough {
  const input = new PassThrough();
  for (const line of lines) input.write(`${line}\n`);
  input.end();
  return input;
}

function collectOutput(): { output: PassThrough; written: () => string } {
  const output = new PassThrough();
  let text = "";
  output.on("data", (chunk) => {
    text += String(chunk);
  });
  return { output, written: () => text };
}

describe("missingConfigureFields", () => {
  it("returns all three fields when nothing is configured and no flags are given", () => {
    expect(missingConfigureFields(undefined, {})).toEqual(["protocolId", "baseUrl", "modelId"]);
  });

  it("returns nothing when all three are already present from a stored config", () => {
    expect(
      missingConfigureFields(
        { protocolId: "openai-compatible-chat", baseUrl: "https://example.com", modelId: "m" },
        {},
      ),
    ).toEqual([]);
  });

  it("returns nothing when all three are supplied as flags with no stored config", () => {
    expect(
      missingConfigureFields(undefined, {
        protocolId: "openai-compatible-chat",
        baseUrl: "https://example.com",
        modelId: "m",
      }),
    ).toEqual([]);
  });

  it("merges stored config and flags, reporting only what neither side supplies", () => {
    expect(
      missingConfigureFields({ protocolId: "openai-compatible-chat" }, { baseUrl: "https://x" }),
    ).toEqual(["modelId"]);
  });

  it("reports a subset in protocolId, baseUrl, modelId order regardless of which is missing", () => {
    expect(missingConfigureFields(undefined, { protocolId: "x", modelId: "m" })).toEqual([
      "baseUrl",
    ]);
    expect(missingConfigureFields(undefined, { baseUrl: "https://x" })).toEqual([
      "protocolId",
      "modelId",
    ]);
  });
});

describe("configureFlagName", () => {
  it("maps each field to its CLI flag", () => {
    expect(configureFlagName("protocolId")).toBe("--protocol");
    expect(configureFlagName("baseUrl")).toBe("--base-url");
    expect(configureFlagName("modelId")).toBe("--model");
  });
});

describe("promptMissingConfigureValues", () => {
  const strings = cliStrings("en");

  it("fills in all three fields from sequential answers", async () => {
    const input = sendLines(["openai-compatible-chat", "https://api.example.com/v1", "gpt-4o"]);
    const reader = new LineReader(input);
    const { output, written } = collectOutput();

    const result = await promptMissingConfigureValues(
      ["protocolId", "baseUrl", "modelId"],
      strings,
      reader,
      output,
    );

    expect(result).toEqual({
      protocolId: "openai-compatible-chat",
      baseUrl: "https://api.example.com/v1",
      modelId: "gpt-4o",
    });
    expect(written()).toContain("Protocol [");
    expect(written()).toContain("Base URL: ");
    expect(written()).toContain("Model ID: ");
  });

  it("trims whitespace and treats a blank answer as abandoning that field", async () => {
    const input = sendLines(["  ", "gpt-4o  "]);
    const reader = new LineReader(input);
    const { output } = collectOutput();

    const result = await promptMissingConfigureValues(
      ["protocolId", "modelId"],
      strings,
      reader,
      output,
    );

    expect(result).toEqual({ modelId: "gpt-4o" });
  });

  it("retries an invalid base URL and keeps the value once it becomes valid", async () => {
    const input = sendLines(["not-a-url", "https://api.example.com/v1"]);
    const reader = new LineReader(input);
    const { output, written } = collectOutput();

    const result = await promptMissingConfigureValues(["baseUrl"], strings, reader, output);

    expect(result).toEqual({ baseUrl: "https://api.example.com/v1" });
    expect(written()).toContain(strings.configurePromptRetryBaseUrl);
  });

  it("gives up after two invalid base URL retries and passes the last answer through", async () => {
    const input = sendLines(["not-a-url", "still-not-a-url", "nope-either"]);
    const reader = new LineReader(input);
    const { output, written } = collectOutput();

    const result = await promptMissingConfigureValues(["baseUrl"], strings, reader, output);

    // Three attempts total (1 initial + 2 retries): the caller's later Zod
    // parse reports the format error, this function does not duplicate it.
    expect(result).toEqual({ baseUrl: "nope-either" });
    const retryCount = written().split(strings.configurePromptRetryBaseUrl).length - 1;
    expect(retryCount).toBe(2);
  });

  it("abandons the base URL field when the user gives a blank answer instead of retrying", async () => {
    const input = sendLines(["not-a-url", ""]);
    const reader = new LineReader(input);
    const { output } = collectOutput();

    const result = await promptMissingConfigureValues(["baseUrl"], strings, reader, output);

    expect(result).toEqual({});
  });

  it("rejects with ConfigurePromptCancelled on Ctrl+C (\\u0003)", async () => {
    const input = sendLines(["openai-compatible-chat", "\u0003"]);
    const reader = new LineReader(input);
    const { output } = collectOutput();

    await expect(
      promptMissingConfigureValues(["protocolId", "baseUrl"], strings, reader, output),
    ).rejects.toBeInstanceOf(ConfigurePromptCancelled);
  });

  it("rejects with ConfigurePromptCancelled on EOF before an answer is given", async () => {
    const input = new PassThrough();
    input.end();
    const reader = new LineReader(input);
    const { output } = collectOutput();

    await expect(
      promptMissingConfigureValues(["protocolId"], strings, reader, output),
    ).rejects.toBeInstanceOf(ConfigurePromptCancelled);
  });

  it("rejects with ConfigurePromptCancelled on EOF mid-way through a partially typed answer", async () => {
    const input = new PassThrough();
    input.write("partial-no-newline");
    input.end();
    const reader = new LineReader(input);
    const { output } = collectOutput();

    await expect(
      promptMissingConfigureValues(["modelId"], strings, reader, output),
    ).rejects.toBeInstanceOf(ConfigurePromptCancelled);
  });
});

describe("confirmConfigureSummary", () => {
  const strings = cliStrings("en");
  const summary = {
    protocolId: "openai-compatible-chat",
    baseUrl: "https://api.example.com/v1",
    modelId: "gpt-4o",
    apiKeyStatus: "will-prompt" as const,
  };

  it.each(["y", "yes", "Y", "YES", " y "])("confirms on %j", async (answer) => {
    const input = sendLines([answer]);
    const reader = new LineReader(input);
    const { output } = collectOutput();

    await expect(confirmConfigureSummary(summary, strings, reader, output)).resolves.toBe(true);
  });

  it.each(["n", "", "maybe"])("rejects on %j", async (answer) => {
    const input = sendLines([answer]);
    const reader = new LineReader(input);
    const { output } = collectOutput();

    await expect(confirmConfigureSummary(summary, strings, reader, output)).resolves.toBe(false);
  });

  it("rejects with ConfigurePromptCancelled on Ctrl+C (\\u0003)", async () => {
    const input = sendLines(["\u0003"]);
    const reader = new LineReader(input);
    const { output } = collectOutput();

    await expect(confirmConfigureSummary(summary, strings, reader, output)).rejects.toBeInstanceOf(
      ConfigurePromptCancelled,
    );
  });

  it("rejects with ConfigurePromptCancelled on EOF before an answer is given", async () => {
    const input = new PassThrough();
    input.end();
    const reader = new LineReader(input);
    const { output } = collectOutput();

    await expect(confirmConfigureSummary(summary, strings, reader, output)).rejects.toBeInstanceOf(
      ConfigurePromptCancelled,
    );
  });

  it("echoes the merged field values for confirmation", async () => {
    const input = sendLines(["y"]);
    const reader = new LineReader(input);
    const { output, written } = collectOutput();

    await confirmConfigureSummary(summary, strings, reader, output);

    expect(written()).toContain("openai-compatible-chat");
    expect(written()).toContain("https://api.example.com/v1");
    expect(written()).toContain("gpt-4o");
  });

  // ConfigureSummary never carries an API key field (see its type above), so
  // the function has no value it could leak here by construction; the
  // end-to-end proof that a real secret never reaches stderr lives in
  // configure-missing-args.test.ts's EVIR_API_KEY integration test.
  it("renders the status line that matches each apiKeyStatus", async () => {
    const expectedLine = {
      "none-required": strings.configureSummaryKeyNone,
      "env-override": strings.configureSummaryKeyEnv,
      "will-prompt": strings.configureSummaryKeyPrompt,
    } as const;

    for (const apiKeyStatus of Object.keys(expectedLine) as (keyof typeof expectedLine)[]) {
      const input = sendLines(["y"]);
      const reader = new LineReader(input);
      const { output, written } = collectOutput();

      await confirmConfigureSummary({ ...summary, apiKeyStatus }, strings, reader, output);

      expect(written()).toContain(expectedLine[apiKeyStatus]);
    }
  });

  it("lets one shared reader serve the prompt step and then the confirm step, mirroring cli.ts", async () => {
    const input = sendLines([
      "openai-compatible-chat",
      "https://api.example.com/v1",
      "gpt-4o",
      "y",
    ]);
    const reader = new LineReader(input);
    const { output } = collectOutput();

    const values = await promptMissingConfigureValues(
      ["protocolId", "baseUrl", "modelId"],
      strings,
      reader,
      output,
    );
    expect(values).toEqual({
      protocolId: "openai-compatible-chat",
      baseUrl: "https://api.example.com/v1",
      modelId: "gpt-4o",
    });

    const confirmed = await confirmConfigureSummary(
      {
        protocolId: values.protocolId ?? "",
        baseUrl: values.baseUrl ?? "",
        modelId: values.modelId ?? "",
        apiKeyStatus: "will-prompt",
      },
      strings,
      reader,
      output,
    );
    expect(confirmed).toBe(true);
  });
});
