import { describe, expect, it } from "vitest";
import { PROVIDER_PRESETS } from "../provider-presets";
import {
  AGENT_VERIFIED_MIN_TASKS,
  EVAL_MIN_SUCCESS_RATE,
  EVAL_MIN_TOOL_CALL_SUCCESS,
  REQUIRED_SUITE_ID,
  REQUIRED_SUITE_VERSION,
  SMOKE_VERIFIED_MIN_TASKS,
  capModelHistory,
  effectiveAgentTier,
  effectiveAgentTiers,
  effectiveModelAgentTier,
  entryQualifies,
  latestModelEval,
  modelValidationHistory,
  resolveModelTier,
  verifiedModelsForProvider,
  type ProviderValidationEntry,
} from "../provider-tiers";

/**
 * Tier semantics (§5-§14, §61, §69-§75):
 * - evidence is MODEL-level and never transfers across models;
 * - every real eval enters history and the LATEST run decides the tier —
 *   a fresh regression can never hide behind an older PASS;
 * - full-suite pass → agent-verified, smoke-scale pass → smoke-verified,
 *   regression after a historical pass → needs-revalidation.
 */

function entry(overrides: Partial<ProviderValidationEntry> = {}): ProviderValidationEntry {
  return {
    providerId: "zhipu",
    modelId: "glm-5.3",
    endpointClass: "official",
    endpointHostClass: "open.bigmodel.cn",
    protocol: "openai-compatible-chat",
    testedAt: "2026-09-01T00:00:00.000Z",
    evirCommit: "test",
    suiteId: REQUIRED_SUITE_ID,
    evalSuiteVersion: REQUIRED_SUITE_VERSION,
    taskCount: AGENT_VERIFIED_MIN_TASKS,
    passed: AGENT_VERIFIED_MIN_TASKS,
    failed: 0,
    successRate: 1,
    toolCallSuccessRate: 1,
    unauthorizedOperations: 0,
    outOfScopeChanges: 0,
    status: "pass",
    ...overrides,
  };
}

const zhipuPreset = () => PROVIDER_PRESETS.find((preset) => preset.id === "zhipu")!;

const failEntry = (overrides: Partial<ProviderValidationEntry> = {}) =>
  entry({
    passed: 0,
    failed: AGENT_VERIFIED_MIN_TASKS,
    successRate: 0,
    toolCallSuccessRate: 0,
    status: "fail",
    ...overrides,
  });

describe("shipped validation data integrity", () => {
  it("every entry carries model-level + endpoint identity", () => {
    for (const item of modelValidationHistory("zhipu", "evomap-deepseek-v4-flash")) {
      expect(item.modelId.length).toBeGreaterThan(0);
      expect(["official", "gateway", "self-hosted"]).toContain(item.endpointClass);
      expect(item.endpointHostClass ?? "").not.toBe("");
      expect(item.suiteId).toBe(REQUIRED_SUITE_ID);
      expect(["pass", "fail", "partial"]).toContain(item.status);
    }
  });

  it("the shipped 10-task gateway evidence is smoke-scale, never agent-verified", () => {
    const models = verifiedModelsForProvider("zhipu");
    const deepseek = models.find((model) => model.modelId === "evomap-deepseek-v4-flash");
    expect(deepseek?.tier).toBe("smoke-verified");
    expect(deepseek?.endpointClass).toBe("gateway");
  });

  it("no preset claims provider-level agent-verified anymore (§7)", () => {
    expect(
      PROVIDER_PRESETS.filter((preset) => (preset.agentTier as string) === "agent-verified"),
    ).toEqual([]);
  });

  it("effective tier exists for every preset id", () => {
    const tiers = effectiveAgentTiers();
    expect(tiers.size).toBe(PROVIDER_PRESETS.length);
    for (const preset of PROVIDER_PRESETS) {
      expect(tiers.get(preset.id)).toBeDefined();
    }
  });

  it("protocol-verified set matches the automated protocol coverage", () => {
    const protocolVerified = PROVIDER_PRESETS.filter(
      (preset) => preset.agentTier === "protocol-verified",
    ).map((preset) => preset.id);
    expect([...protocolVerified].sort()).toEqual(
      ["anthropic", "azure-openai", "google-gemini", "ollama", "openai", "zhipu"].sort(),
    );
  });
});

describe("model-level evidence (no cross-model borrowing, §8)", () => {
  it("deepseek evidence on the zhipu preset never verifies a GLM model", () => {
    expect(effectiveModelAgentTier(zhipuPreset(), "glm-4.7")).toBe("protocol-verified");
  });

  it("model match is case-insensitive but exact — no family wildcards", () => {
    expect(effectiveModelAgentTier(zhipuPreset(), "EVOMAP-DeepSeek-V4-Flash")).toBe(
      "smoke-verified",
    );
    expect(effectiveModelAgentTier(zhipuPreset(), "evomap-deepseek-v4")).toBe("protocol-verified");
  });

  it("evidence from another provider does not leak across providers", () => {
    const openai = PROVIDER_PRESETS.find((preset) => preset.id === "openai")!;
    const tier = resolveModelTier(
      openai,
      "evomap-deepseek-v4-flash",
      modelValidationHistory("zhipu", "evomap-deepseek-v4-flash"),
    );
    expect(tier).toBe(openai.agentTier);
  });
});

describe("latest real eval decides the tier (§12-§13, §61)", () => {
  it("an old PASS followed by a newer FAIL downgrades to needs-revalidation", () => {
    const tier = resolveModelTier(zhipuPreset(), "glm-5.3", [
      entry({ testedAt: "2026-09-01T00:00:00.000Z", status: "pass" }),
      failEntry({ testedAt: "2026-09-08T00:00:00.000Z" }),
    ]);
    expect(tier).toBe("needs-revalidation");
  });

  it("the same history with the FAIL first and a later PASS recovers", () => {
    const tier = resolveModelTier(zhipuPreset(), "glm-5.3", [
      failEntry({ testedAt: "2026-09-01T00:00:00.000Z" }),
      entry({ testedAt: "2026-09-08T00:00:00.000Z", status: "pass" }),
    ]);
    expect(tier).toBe("agent-verified");
  });

  it("a FAIL with no historical qualifying pass stays at the preset's protocol tier", () => {
    const tier = resolveModelTier(zhipuPreset(), "glm-5.3", [
      failEntry({ suiteId: "other-suite", testedAt: "2026-09-08T00:00:00.000Z" }),
    ]);
    expect(tier).toBe("protocol-verified");
  });

  it("suite version expiry forces revalidation instead of keeping a stale verified tier (§14)", () => {
    const tier = resolveModelTier(zhipuPreset(), "glm-5.3", [
      entry({ evalSuiteVersion: "agent-eval-v0" }),
    ]);
    expect(tier).toBe("needs-revalidation");
  });

  it("latestModelEval returns the newest run regardless of outcome", () => {
    expect(latestModelEval("zhipu", "evomap-deepseek-v4-flash")?.status).toBe("pass");
  });
});

describe("suite scale separates agent-verified from smoke (§60)", () => {
  it("a qualifying smoke-scale run yields smoke-verified, never agent-verified", () => {
    const tier = resolveModelTier(zhipuPreset(), "glm-5.3", [
      entry({ taskCount: SMOKE_VERIFIED_MIN_TASKS, passed: SMOKE_VERIFIED_MIN_TASKS }),
    ]);
    expect(tier).toBe("smoke-verified");
    expect(SMOKE_VERIFIED_MIN_TASKS).toBeLessThan(AGENT_VERIFIED_MIN_TASKS);
  });

  it("below the gate thresholds a run never qualifies at any scale (§14)", () => {
    expect(entryQualifies(entry({ successRate: EVAL_MIN_SUCCESS_RATE - 0.1 }))).toBe(false);
    expect(entryQualifies(entry({ toolCallSuccessRate: EVAL_MIN_TOOL_CALL_SUCCESS - 0.1 }))).toBe(
      false,
    );
    expect(entryQualifies(entry({ unauthorizedOperations: 1 }))).toBe(false);
    expect(entryQualifies(entry({ outOfScopeChanges: 1 }))).toBe(false);
    expect(entryQualifies(entry({ status: "partial" }))).toBe(false);
    expect(entryQualifies(entry())).toBe(true);
  });

  it("provider rollup reflects the strongest verified model", () => {
    expect(effectiveAgentTier(zhipuPreset())).toBe("smoke-verified"); // today: gateway deepseek, smoke scale
  });

  it("verifiedModelsForProvider lists per-model tiers from a given history", () => {
    const models = verifiedModelsForProvider("zhipu", [
      entry({ modelId: "glm-5.3" }),
      entry({
        modelId: "glm-4.7",
        taskCount: SMOKE_VERIFIED_MIN_TASKS,
        passed: SMOKE_VERIFIED_MIN_TASKS,
      }),
      failEntry({ modelId: "glm-4.6", testedAt: "2026-09-09T00:00:00.000Z" }),
    ]);
    expect(models.map((model) => [model.modelId, model.tier])).toEqual([
      ["glm-5.3", "agent-verified"],
      ["glm-4.7", "smoke-verified"],
    ]);
  });
});

describe("history is append-only but bounded (§11 + file hygiene)", () => {
  it("capModelHistory keeps the newest entries per model only", () => {
    const many = Array.from({ length: 15 }, (_, index) =>
      entry({ testedAt: `2026-09-${String(index + 1).padStart(2, "0")}T00:00:00.000Z` }),
    );
    const file = { version: 2 as const, entries: [...many] };
    capModelHistory(file, "zhipu", "glm-5.3");
    expect(file.entries.length).toBe(10);
    const newest = [...file.entries].sort((a, b) => b.testedAt.localeCompare(a.testedAt))[0];
    expect(newest?.testedAt).toBe("2026-09-15T00:00:00.000Z");

    const untouched = entry({ providerId: "zhipu", modelId: "other-model" });
    const file2 = { version: 2 as const, entries: [untouched] };
    capModelHistory(file2, "zhipu", "glm-5.3");
    expect(file2.entries).toEqual([untouched]);
  });
});
