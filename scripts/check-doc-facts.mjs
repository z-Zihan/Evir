#!/usr/bin/env node
/**
 * Doc-facts gate (§lightweight, no new governance system): fact conflicts →
 * exit 1 so CI fails. Verifies:
 *
 * 1. Provider tier facts: the README tier tables must match the EFFECTIVE
 *    tiers derived from src/core/providers/provider-presets.ts +
 *    provider-validation.json (same source Settings uses).
 * 2. Product maturity wording: "冻结扩张" / "Expansion frozen" must not
 *    appear in the living docs (the product decision is priority
 *    management, not freezing).
 *
 * Run via `pnpm check` (wired into the aggregate gate).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];

function read(relativePath) {
  return readFileSync(join(root, relativePath), "utf8");
}

// --- 1. Effective provider tiers -------------------------------------------
const presetsSource = read("src/core/providers/provider-presets.ts");
const validationRaw = JSON.parse(read("src/core/providers/provider-validation.json"));

/** id → display name (preset-level fields are indented 4 spaces). */
const presetNames = new Map();
for (const match of presetsSource.matchAll(/\n {4}id: "([^"]+)",[\s\S]*?\n {4}name: "([^"]+)"/g)) {
  presetNames.set(match[1], match[2]);
}
const presetTiers = new Map();
for (const match of presetsSource.matchAll(
  /\n {4}id: "([^"]+)",[\s\S]*?\n {4}agentTier: "([^"]+)"/g,
)) {
  presetTiers.set(match[1], match[2]);
}
if (presetTiers.size === 0 || presetTiers.size !== presetNames.size) {
  failures.push(
    `presets parse: ${presetTiers.size} tiers vs ${presetNames.size} names — expected equal`,
  );
}

function qualifies(entry) {
  return (
    entry.taskCount >= 10 &&
    entry.successRate >= 0.8 &&
    entry.toolCallSuccess >= 0.8 &&
    entry.unauthorizedOperations === 0 &&
    entry.outOfScopeChanges === 0
  );
}
const evidence = new Set(
  (validationRaw.entries ?? []).filter(qualifies).map((entry) => entry.providerId),
);

const effective = new Map();
for (const [id, tier] of presetTiers) {
  effective.set(id, tier === "agent-verified" && !evidence.has(id) ? "protocol-verified" : tier);
}

function tierNameList(tier) {
  return [...effective.entries()]
    .filter(([, value]) => value === tier)
    .map(([id]) => presetNames.get(id) ?? id)
    .sort((a, b) => a.localeCompare(b));
}

const agentVerifiedNames = tierNameList("agent-verified");
const protocolVerifiedNames = tierNameList("protocol-verified");
const presetCount = tierNameList("preset").length;

/** Extract the vendors cell of a `| **<Label>** | ... | <cell> |` table row. */
function tierRowCell(content, label) {
  const row = content
    .split("\n")
    .find((line) => line.includes(`**${label}**`) && line.trim().startsWith("|"));
  if (!row) return null;
  const cells = row.split("|").map((cell) => cell.trim());
  return cells.length >= 4 ? cells[cells.length - 2] : null;
}

function namesFromCell(cell) {
  return cell
    .split(/[、,]/)
    .map((piece) => piece.trim())
    .filter((piece) => piece.length > 0);
}

function checkReadmeTierTable(fileName, emptyAgentMarker) {
  const content = read(fileName);
  const agentCell = tierRowCell(content, "Agent Verified");
  const protocolCell = tierRowCell(content, "Protocol Verified");
  if (agentCell === null || protocolCell === null) {
    failures.push(`${fileName}: missing Agent Verified / Protocol Verified tier rows`);
    return;
  }
  if (agentVerifiedNames.length === 0) {
    if (!agentCell.includes(emptyAgentMarker)) {
      failures.push(
        `${fileName}: Agent Verified row must state "${emptyAgentMarker}" (no evidence)`,
      );
    }
  } else {
    const listed = namesFromCell(agentCell);
    const expected = new Set(agentVerifiedNames);
    for (const name of listed) {
      if (!expected.has(name))
        failures.push(`${fileName}: Agent Verified lists non-verified "${name}"`);
    }
    for (const name of agentVerifiedNames) {
      if (!listed.includes(name)) failures.push(`${fileName}: Agent Verified missing "${name}"`);
    }
  }
  const listedProtocol = namesFromCell(protocolCell);
  const expectedProtocol = new Set(protocolVerifiedNames);
  for (const name of listedProtocol) {
    if (!expectedProtocol.has(name)) {
      failures.push(
        `${fileName}: Protocol Verified lists "${name}" which is not protocol-verified`,
      );
    }
  }
  for (const name of protocolVerifiedNames) {
    if (!listedProtocol.includes(name))
      failures.push(`${fileName}: Protocol Verified missing "${name}"`);
  }
  const presetMatch = content.match(
    /(?:其余\s*(\d+)\s*家内置预设|the other\s*(\d+)\s*built-in presets)/,
  );
  if (!presetMatch) {
    failures.push(`${fileName}: Preset row must state the current preset count (${presetCount})`);
  } else {
    const stated = Number.parseInt(presetMatch[1] ?? presetMatch[2], 10);
    if (stated !== presetCount) {
      failures.push(
        `${fileName}: Preset row says ${stated} providers, effective tier count is ${presetCount}`,
      );
    }
  }
}

checkReadmeTierTable("README.md", "暂无");
checkReadmeTierTable("README.en.md", "None yet");

// --- 2. Freeze wording ------------------------------------------------------
const freezeBanned = [
  { file: "README.md", patterns: [/冻结扩张/] },
  { file: "README.en.md", patterns: [/Expansion frozen/i] },
  { file: "docs/agent/Evir-project-memory.md", patterns: [/冻结扩张/] },
];
for (const { file, patterns } of freezeBanned) {
  const content = read(file);
  for (const pattern of patterns) {
    if (pattern.test(content)) failures.push(`${file}: contains banned freeze wording ${pattern}`);
  }
}

if (failures.length > 0) {
  console.error(`doc-facts gate failed (${failures.length}):`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log(
  `doc-facts gate passed: agent-verified=[${agentVerifiedNames.join(", ") || "none"}], protocol-verified=${protocolVerifiedNames.length}, preset=${presetCount}`,
);
