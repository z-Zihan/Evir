import { describe, expect, it } from "vitest";
import { PROVIDER_PRESETS } from "../provider-presets";
import {
  agentVerificationEvidence,
  effectiveAgentTier,
  effectiveAgentTiers,
} from "../provider-tiers";

/**
 * Tier consistency (§48/§50): an agent-verified claim is only effective with
 * a qualifying real-endpoint entry in provider-validation.json. This test is
 * the automated guard — README/Settings may never claim more than evidence.
 */
describe("provider tier evidence gating", () => {
  it("downgrades agent-verified claims without qualifying evidence", () => {
    // The validation file ships without entries until a real Golden-Tasks
    // run lands one; any preset claiming agent-verified must downgrade.
    for (const preset of PROVIDER_PRESETS) {
      if (preset.agentTier === "agent-verified" && !agentVerificationEvidence(preset.id)) {
        expect(effectiveAgentTier(preset)).toBe("protocol-verified");
      }
    }
  });

  it("never upgrades protocol-verified or preset tiers via evidence absence", () => {
    for (const preset of PROVIDER_PRESETS) {
      if (preset.agentTier !== "agent-verified") {
        expect(effectiveAgentTier(preset)).toBe(preset.agentTier);
      }
    }
  });

  it("exposes an effective tier for every preset id", () => {
    const tiers = effectiveAgentTiers();
    expect(tiers.size).toBe(PROVIDER_PRESETS.length);
    for (const preset of PROVIDER_PRESETS) {
      expect(tiers.get(preset.id)).toBeDefined();
    }
  });

  it("agent-verified presets exist and are exactly the GLM/zhipu family today", () => {
    const claimed = PROVIDER_PRESETS.filter((preset) => preset.agentTier === "agent-verified");
    expect(claimed.map((preset) => preset.id)).toEqual(["zhipu"]);
  });

  it("protocol-verified set matches the automated protocol coverage", () => {
    const protocolVerified = PROVIDER_PRESETS.filter(
      (preset) => preset.agentTier === "protocol-verified",
    ).map((preset) => preset.id);
    expect([...protocolVerified].sort()).toEqual(
      ["anthropic", "azure-openai", "google-gemini", "ollama", "openai"].sort(),
    );
  });
});
