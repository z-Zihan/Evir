/**
 * Provider maturity tiers must come from machine-verifiable facts (§48/§50),
 * evaluated at MODEL level with endpoint awareness (§5-§14, §69-§75).
 *
 * Rules:
 * 1. Evidence is keyed by providerId + modelId (+ endpoint class). An entry
 *    recorded for `zhipu`/`evomap-deepseek-v4-flash` can never verify
 *    `zhipu`/`glm-4.7` — no cross-model evidence borrowing.
 * 2. EVERY real eval run (pass/fail/partial) lands in validation history;
 *    the effective tier follows the LATEST required real eval, so a fresh
 *    regression can never hide behind an older PASS.
 * 3. Tier ladder: agent-verified (full required suite, current version) →
 *    smoke-verified (smoke-scale pass) → needs-revalidation (passed
 *    historically, latest eval regressed / suite version expired) →
 *    protocol-verified / preset (protocol-level facts only).
 */
import validationData from "./provider-validation.json";
import { PROVIDER_PRESETS } from "./provider-presets";
import type { ProviderAgentTier, ProviderPreset } from "./types";

/** Where the eval traffic actually went (§9): never just "GLM" for EvoMap. */
export type EndpointClass = "official" | "gateway" | "self-hosted";

export interface ProviderValidationEntry {
  /** Preset id the eval ran through (e.g. "zhipu"). */
  providerId: string;
  /** The model id ON THE ENDPOINT — evidence never transfers across models. */
  modelId: string;
  /** Optional family grouping for display (e.g. "glm", "deepseek"). */
  modelFamily?: string;
  /** Official vendor endpoint vs third-party gateway vs self-hosted. */
  endpointClass: EndpointClass;
  /** Host identity only (never a path, never a key), e.g. "api.evomap.cn". */
  endpointHostClass?: string;
  protocol: string;
  /** ISO timestamp of the real run. */
  testedAt: string;
  /** Evir commit the eval ran on. */
  evirCommit: string;
  /** Which eval suite produced this entry (e.g. "golden-agent-tasks"). */
  suiteId: string;
  evalSuiteVersion: string;
  taskCount: number;
  passed: number;
  failed: number;
  successRate: number;
  /** Share of tool calls that executed without tool-layer errors (0-1). */
  toolCallSuccessRate: number;
  unauthorizedOperations: number;
  outOfScopeChanges: number;
  status: "pass" | "fail" | "partial";
}

export interface ProviderValidationFile {
  version: 1 | 2;
  entries: ProviderValidationEntry[];
}

/** The suite identity + version that today's tier gates require (§14). */
export const REQUIRED_SUITE_ID = "golden-agent-tasks";
export const REQUIRED_SUITE_VERSION = "agent-eval-v1";

/** Gates an eval entry must clear to qualify at any scale (§14). */
export const EVAL_MIN_SUCCESS_RATE = 0.8;
export const EVAL_MIN_TOOL_CALL_SUCCESS = 0.8;
/**
 * The VERIFIED bar (E2 tier review): "Agent Verified" claims a model can
 * actually run agent work — 4 failures in 20 tasks does not say that. A
 * qualifying run in [0.8, 0.9) earns the honest middle tier
 * "eval-candidate" (real eval passed, below the verified bar) instead.
 */
export const VERIFIED_MIN_SUCCESS_RATE = 0.9;

/** Full required suite scale vs smoke scale (§60). */
export const AGENT_VERIFIED_MIN_TASKS = 20;
export const SMOKE_VERIFIED_MIN_TASKS = 10;

/** How many history entries to keep per provider+model+suite. */
const HISTORY_CAP_PER_MODEL = 10;

const validation = validationData as ProviderValidationFile;

/** Normalize v1 entries (toolCallSuccess) into the v2 shape on read. */
function normalizeEntry(
  entry: ProviderValidationEntry & { toolCallSuccess?: number },
): ProviderValidationEntry {
  const toolCallSuccessRate = entry.toolCallSuccessRate ?? entry.toolCallSuccess ?? 0;
  const status =
    entry.status ??
    (entry.successRate >= EVAL_MIN_SUCCESS_RATE &&
    toolCallSuccessRate >= EVAL_MIN_TOOL_CALL_SUCCESS &&
    entry.unauthorizedOperations === 0 &&
    entry.outOfScopeChanges === 0
      ? "pass"
      : "partial");
  return { ...entry, toolCallSuccessRate, status };
}

const entries: ProviderValidationEntry[] = validation.entries.map((entry) =>
  normalizeEntry(entry as ProviderValidationEntry & { toolCallSuccess?: number }),
);

/** Case-insensitive exact model match — no wildcards, no family borrowing. */
function sameModel(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

function sortLatestFirst(list: ProviderValidationEntry[]): ProviderValidationEntry[] {
  return [...list].sort((a, b) => b.testedAt.localeCompare(a.testedAt));
}

/** Did this run clear every per-run gate (scale-independent)? */
export function entryQualifies(entry: ProviderValidationEntry): boolean {
  return (
    entry.taskCount >= SMOKE_VERIFIED_MIN_TASKS &&
    entry.successRate >= EVAL_MIN_SUCCESS_RATE &&
    entry.toolCallSuccessRate >= EVAL_MIN_TOOL_CALL_SUCCESS &&
    entry.unauthorizedOperations === 0 &&
    entry.outOfScopeChanges === 0 &&
    entry.status === "pass"
  );
}

/** Full required-suite scale (vs smoke scale) for a qualifying run. */
export function isRequiredSuiteScale(entry: ProviderValidationEntry): boolean {
  return entry.taskCount >= AGENT_VERIFIED_MIN_TASKS;
}

/** A qualifying run that ALSO clears the >=90% verified bar. */
export function entryMeetsVerifiedBar(entry: ProviderValidationEntry): boolean {
  return entry.successRate >= VERIFIED_MIN_SUCCESS_RATE;
}

/**
 * Endpoint class of a concrete connection (A4.2): evidence never crosses
 * official/gateway/self-hosted. Host matching against the preset's official
 * endpoints; loopback/private hosts are self-hosted; anything else is a
 * third-party gateway.
 */
export function connectionEndpointClass(
  preset: Pick<ProviderPreset, "endpoints">,
  baseUrl: string | null | undefined,
): EndpointClass {
  if (!baseUrl) return "official";
  let host: string;
  try {
    host = new URL(baseUrl).hostname.toLowerCase();
  } catch {
    return "official";
  }
  if (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    host.endsWith(".local") ||
    host.startsWith("10.") ||
    host.startsWith("192.168.") ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host)
  ) {
    return "self-hosted";
  }
  const officialHosts = new Set(
    (preset.endpoints ?? [])
      .map((endpoint) => {
        try {
          return new URL(endpoint.baseUrl).hostname.toLowerCase();
        } catch {
          return "";
        }
      })
      .filter(Boolean),
  );
  return officialHosts.has(host) ? "official" : "gateway";
}

/** History for one provider+model (any outcome — FAILs are kept, §11). */
export function modelValidationHistory(
  providerId: string,
  modelId: string,
): ProviderValidationEntry[] {
  return sortLatestFirst(
    entries.filter((entry) => entry.providerId === providerId && sameModel(entry.modelId, modelId)),
  );
}

/** Latest real eval for a provider+model — pass or fail (§12). */
export function latestModelEval(
  providerId: string,
  modelId: string,
): ProviderValidationEntry | undefined {
  return modelValidationHistory(providerId, modelId)[0];
}

/**
 * Effective tier for ONE model on a preset. Evidence must match the model id
 * exactly; a `zhipu`+`deepseek-x` entry never verifies `glm-4.7` (§8).
 * Pure over the given history so tests exercise the real decision rule.
 */
export function resolveModelTier(
  preset: Pick<ProviderPreset, "id" | "agentTier">,
  modelId: string | null | undefined,
  history: readonly ProviderValidationEntry[],
  endpointClass?: EndpointClass,
): ProviderAgentTier {
  if (!modelId) return preset.agentTier;
  const sorted = sortLatestFirst(
    history.filter(
      (entry) =>
        entry.providerId === preset.id &&
        sameModel(entry.modelId, modelId) &&
        // Evidence is endpoint-scoped (A4.2): an official-endpoint entry
        // never verifies the same modelId through a gateway, or vice versa.
        (endpointClass === undefined || entry.endpointClass === endpointClass),
    ),
  );
  const latest = sorted[0];
  if (!latest) return preset.agentTier;

  const everQualified = sorted.some((item) => entryQualifies(item));
  // A suite-version bump invalidates old evidence: an eval that passed
  // suite v0 must not stay verified forever once the gate moves to v1 (§14).
  const suiteCurrent =
    latest.suiteId === REQUIRED_SUITE_ID && latest.evalSuiteVersion === REQUIRED_SUITE_VERSION;

  if (entryQualifies(latest)) {
    if (!suiteCurrent) {
      // Qualifying run on an outdated suite version: honest middle state.
      return everQualified ? "needs-revalidation" : preset.agentTier;
    }
    if (entryMeetsVerifiedBar(latest)) {
      return isRequiredSuiteScale(latest) ? "agent-verified" : "smoke-verified";
    }
    // Qualifying real eval below the >=90% verified bar: honest middle tier.
    return "eval-candidate";
  }
  // Latest required real eval regressed (fail/partial or below gates).
  if (suiteCurrent || everQualified) return "needs-revalidation";
  return preset.agentTier;
}

export function effectiveModelAgentTier(
  preset: Pick<ProviderPreset, "id" | "agentTier">,
  modelId: string | null | undefined,
  endpointClass?: EndpointClass,
): ProviderAgentTier {
  return resolveModelTier(preset, modelId, entries, endpointClass);
}

export interface VerifiedModelSummary {
  modelId: string;
  tier: Extract<ProviderAgentTier, "agent-verified" | "smoke-verified" | "eval-candidate">;
  testedAt: string;
  endpointClass: EndpointClass;
  endpointHostClass?: string;
  taskCount: number;
}

/**
 * Models under a provider whose LATEST required real eval qualifies. Drives
 * the provider-level rollup so README/Settings can show exactly WHICH models
 * are verified (§7) instead of a provider-wide "Agent Verified" claim.
 */
export function verifiedModelsForProvider(
  providerId: string,
  history: readonly ProviderValidationEntry[] = entries,
): VerifiedModelSummary[] {
  const byModel = new Map<string, ProviderValidationEntry>();
  for (const entry of history) {
    if (entry.providerId !== providerId) continue;
    const key = entry.modelId.trim().toLowerCase();
    const existing = byModel.get(key);
    if (!existing || entry.testedAt > existing.testedAt) byModel.set(key, entry);
  }
  const summaries: VerifiedModelSummary[] = [];
  for (const latest of byModel.values()) {
    if (!entryQualifies(latest)) continue;
    if (
      latest.suiteId !== REQUIRED_SUITE_ID ||
      latest.evalSuiteVersion !== REQUIRED_SUITE_VERSION
    ) {
      continue;
    }
    summaries.push({
      modelId: latest.modelId,
      tier: entryMeetsVerifiedBar(latest)
        ? isRequiredSuiteScale(latest)
          ? "agent-verified"
          : "smoke-verified"
        : "eval-candidate",
      testedAt: latest.testedAt,
      endpointClass: latest.endpointClass,
      ...(latest.endpointHostClass ? { endpointHostClass: latest.endpointHostClass } : {}),
      taskCount: latest.taskCount,
    });
  }
  return summaries.sort((a, b) => b.testedAt.localeCompare(a.testedAt));
}

/**
 * Provider-level rollup for catalog/README surfaces (no specific model
 * selected): the strongest tier any verified model currently holds. Model
 * selection screens must use effectiveModelAgentTier instead.
 */
export function effectiveAgentTier(
  preset: Pick<ProviderPreset, "id" | "agentTier">,
): ProviderAgentTier {
  const verified = verifiedModelsForProvider(preset.id);
  if (verified.some((model) => model.tier === "agent-verified")) return "agent-verified";
  if (verified.some((model) => model.tier === "smoke-verified")) return "smoke-verified";
  if (verified.length > 0) return "eval-candidate";
  return preset.agentTier;
}

/** Effective tier per preset id — the single source README/Settings share. */
export function effectiveAgentTiers(): ReadonlyMap<string, ProviderAgentTier> {
  return new Map(PROVIDER_PRESETS.map((preset) => [preset.id, effectiveAgentTier(preset)]));
}

/**
 * Trim history for one provider+model+suite to the newest entries. Used by
 * the eval runner when it appends a fresh run (history is append-only but
 * bounded so the shipped file cannot grow without limit).
 */
export function capModelHistory(
  file: { version: 1 | 2; entries: ProviderValidationEntry[] },
  providerId: string,
  modelId: string,
): void {
  const kept = sortLatestFirst(
    file.entries.filter(
      (entry) => entry.providerId === providerId && sameModel(entry.modelId, modelId),
    ),
  ).slice(0, HISTORY_CAP_PER_MODEL);
  const keptKeys = new Set(kept.map((entry) => entry.testedAt + entry.status));
  file.entries = file.entries.filter((entry) => {
    if (entry.providerId !== providerId || !sameModel(entry.modelId, modelId)) return true;
    return keptKeys.has(entry.testedAt + entry.status);
  });
}
