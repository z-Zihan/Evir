import { describe, expect, it } from "vitest";
import { parseArguments } from "../src/arguments";

describe("CLI arguments", () => {
  it("parses ask prompts and agent workspaces", () => {
    expect(parseArguments(["ask", "explain", "this"])).toEqual({
      command: "ask",
      prompt: "explain this",
    });
    expect(parseArguments(["agent", "fix", "tests", "--workspace", "/tmp/project"])).toEqual({
      command: "agent",
      prompt: "fix tests",
      workspace: "/tmp/project",
    });
  });

  it("parses non-secret provider configuration", () => {
    expect(
      parseArguments([
        "configure",
        "--protocol",
        "openai-compatible-chat",
        "--base-url",
        "https://example.com/v1",
        "--model",
        "model-1",
        "--tool-calling",
      ]),
    ).toEqual({
      command: "configure",
      values: {
        protocolId: "openai-compatible-chat",
        baseUrl: "https://example.com/v1",
        modelId: "model-1",
        toolCalling: true,
      },
    });
  });
});
