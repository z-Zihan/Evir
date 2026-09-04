#!/usr/bin/env node
// §32-38 circular dependency audit. Builds the module graph from VALUE imports
// only (`import type` / `import ... type X` edges carry no runtime edge) and
// reports every cycle via DFS. Exit 1 when a runtime cycle exists, so this can
// gate CI. Type-only cycles are listed separately as informational.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, resolve, relative } from "node:path";

const ROOT = process.cwd();
const SRC = join(ROOT, "src");

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    if (name === "__tests__" || name.endsWith(".test.ts") || name.endsWith(".test.tsx")) continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...walk(full));
    else if (/\.(tsx?|mjs)$/.test(name)) out.push(full);
  }
  return out;
}

function resolveSpecifier(fromFile, spec) {
  if (!spec.startsWith(".")) return null; // external package
  const base = resolve(dirname(fromFile), spec);
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.mjs`,
    join(base, "index.ts"),
    join(base, "index.tsx"),
  ];
  for (const candidate of candidates) {
    try {
      if (statSync(candidate).isFile()) return candidate;
    } catch {}
  }
  return null;
}

// edge kinds: "value" | "type"
const edges = new Map(); // file -> [{to, kind}]
for (const file of walk(SRC)) {
  const text = readFileSync(file, "utf8");
  const list = [];
  // Single-line `import type ...` statements.
  for (const m of text.matchAll(/import\s+type\s+[^;]*?from\s+["']([^"']+)["']/g)) {
    const to = resolveSpecifier(file, m[1]);
    if (to) list.push({ to, kind: "type" });
  }
  // Value imports; a named specifier may still be `type X` inside braces.
  const stripped = text.replace(/import\s+type\s+[^;]*?from\s+["'][^"']+["'];?/g, "");
  for (const m of stripped.matchAll(
    /import\s+(?:([A-Za-z_$][\w$]*)\s*,?\s*)?(?:\{([^}]*)\})?\s*from\s+["']([^"']+)["']/g,
  )) {
    const [, defaultSpec, namedSpec, spec] = m;
    const typeOnlyNamed =
      namedSpec !== undefined &&
      namedSpec
        .split(",")
        .filter((part) => part.trim().length > 0)
        .every((part) => part.trim().startsWith("type "));
    const kind = !defaultSpec && typeOnlyNamed ? "type" : "value";
    const to = resolveSpecifier(file, spec);
    if (to) list.push({ to, kind });
  }
  // Dynamic `await import("./x")` — an async inversion point: it executes
  // only after both modules are initialized, so it cannot produce the
  // init-order hazard static cycles cause. Tracked separately.
  for (const m of text.matchAll(/import\(\s*["']([^"']+)["']\s*\)/g)) {
    const to = resolveSpecifier(file, m[1]);
    if (to) list.push({ to, kind: "dynamic" });
  }
  edges.set(file, list);
}

// Tarjan-free simple DFS cycle enumeration (small graph; dedupe by rotation).
const staticGraph = new Map();
const withDynamicGraph = new Map();
const typeGraph = new Map();
for (const [from, list] of edges) {
  staticGraph.set(
    from,
    list.filter((e) => e.kind === "value").map((e) => e.to),
  );
  withDynamicGraph.set(
    from,
    list.filter((e) => e.kind !== "type").map((e) => e.to),
  );
  typeGraph.set(
    from,
    list.map((e) => e.to),
  );
}

function findCycles(graph) {
  const cycles = new Map();
  const stack = [];
  const onPath = new Set();
  const visited = new Set();
  const dfs = (node) => {
    stack.push(node);
    onPath.add(node);
    for (const next of graph.get(node) ?? []) {
      if (!graph.has(next)) continue;
      if (onPath.has(next)) {
        const at = stack.indexOf(next);
        const cycle = stack.slice(at);
        const key = [...cycle].sort().join("|");
        cycles.set(key, cycle);
      } else if (!visited.has(next)) {
        dfs(next);
      }
    }
    stack.pop();
    onPath.delete(node);
    visited.add(node);
  };
  for (const node of graph.keys()) if (!visited.has(node)) dfs(node);
  return [...cycles.values()];
}

const rel = (f) => relative(SRC, f);
const staticCycles = findCycles(staticGraph);
const fullCycles = findCycles(withDynamicGraph);
const typeCycles = findCycles(typeGraph);
const asyncEdges = [];
for (const [from, list] of edges) {
  for (const e of list) if (e.kind === "dynamic") asyncEdges.push(`${rel(from)} -> ${rel(e.to)}`);
}

console.log(`Static runtime cycles (gate): ${staticCycles.length}`);
for (const cycle of staticCycles) console.log("  " + [...cycle, cycle[0]].map(rel).join(" > "));
console.log(
  `Cycles using async inversion edges: ${Math.max(0, fullCycles.length - staticCycles.length)}`,
);
for (const edge of asyncEdges.sort()) console.log(`  async edge: ${edge}`);
console.log(`Type-only cycles (informational): ${typeCycles.length - fullCycles.length}`);
for (const cycle of typeCycles) {
  if (!fullCycles.some((c) => c.join("|") === cycle.join("|"))) {
    console.log("  " + [...cycle, cycle[0]].map(rel).join(" > "));
  }
}

if (staticCycles.length > 0) {
  console.log("\nFAIL: static runtime import cycles must be zero (§32-38).");
  process.exit(1);
}
