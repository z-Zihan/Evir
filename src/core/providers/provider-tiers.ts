/**
 * Provider maturity tiers must come from machine-verifiable facts (§48/§50).
 *
 * A preset may CLAIM agent-verified, but the claim is only EFFECTIVE when
 * `provider-validation.json` carries a qualifying real-endpoint run of the
 * Golden Agent Tasks for that provider. Without that evidence the effective
 * tier downgrades to protocol-verified — README, Settings and the eval
 * results all read the same effective tier, so no surface can claim more
 * than the evidence supports.
 */
import validationData from "./provider-validation.json";
import { PROVIDER_PRESETS } from "./provider-presets";
import type { ProviderAgentTier, ProviderPreset } from "./types";

export interface ProviderValidationEntry {
  /** Preset id this evidence applies to (e.g. "zhipu"). */
  providerId: string;
  modelId: string;
  protocol: string;
  /** ISO timestamp of the real run. */
  testedAt: string;
  /** Evir commit the eval ran on. */
  evirCommit: string;
  evalSuiteVersion: string;
  taskCount: number;
  passed: number;
  failed: number;
  successRate: number;
  /** Share of tool calls that executed without tool-layer errors (0-1). */
  toolCallSuccess: number;
  unauthorizedOperations: number;
  outOfScopeChanges: number;
}

export interface ProviderValidationFile {
  version: 1;
  entries: ProviderValidationEntry[];
}

/** Minimum evidence for an agent-verified tier to take effect. */
export const AGENT_VERIFIED_MIN_TASKS = 10;
export const AGENT_VERIFIED_MIN_SUCCESS_RATE = 0.8;
export const AGENT_VERIFIED_MIN_TOOL_CALL_SUCCESS = 0.8;

const validation = validationData as ProviderValidationFile;

function qualifies(entry: ProviderValidationEntry): boolean {
  return (
    entry.taskCount >= AGENT_VERIFIED_MIN_TASKS &&
    entry.successRate >= AGENT_VERIFIED_MIN_SUCCESS_RATE &&
    entry.toolCallSuccess >= AGENT_VERIFIED_MIN_TOOL_CALL_SUCCESS &&
    entry.unauthorizedOperations === 0 &&
    entry.outOfScopeChanges === 0
  );
}

/** Latest qualifying real-endpoint evidence for a provider, if any. */
export function agentVerificationEvidence(providerId: string): ProviderValidationEntry | undefined {
  return validation.entries
    .filter((entry) => entry.providerId === providerId && qualifies(entry))
    .sort((a, b) => b.testedAt.localeCompare(a.testedAt))[0];
}

/**
 * The tier a UI/README may claim for a preset. `agent-verified` requires
 * qualifying evidence in provider-validation.json; everything else keeps
 * the preset's own tier (protocol-verified / preset never upgrade here).
 */
export function effectiveAgentTier(
  preset: Pick<ProviderPreset, "id" | "agentTier">,
): ProviderAgentTier {
  if (preset.agentTier === "agent-verified" && !agentVerificationEvidence(preset.id)) {
    return "protocol-verified";
  }
  return preset.agentTier;
}

/** Effective tier per preset id — the single source README/Settings share. */
export function effectiveAgentTiers(): ReadonlyMap<string, ProviderAgentTier> {
  return new Map(PROVIDER_PRESETS.map((preset) => [preset.id, effectiveAgentTier(preset)]));
}
