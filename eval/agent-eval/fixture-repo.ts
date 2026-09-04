import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";

/**
 * Deterministic Agent Eval fixture repo (§43): every generation produces a
 * byte-identical tree, so the recorded initial git SHA freezes the fixture
 * for reproducible eval runs. The project is dependency-free (node:test) so
 * `node --test` runs offline in CI and on any machine.
 */

const FIXTURE_FILES: Record<string, string> = {
  "package.json":
    JSON.stringify(
      {
        name: "fixture-app",
        version: "1.0.0",
        private: true,
        type: "module",
        scripts: {
          test: 'node --test "test/*.test.js"',
        },
      },
      null,
      2,
    ) + "\n",
  "README.md": `# Fixture App\n\nDependency-free sample project for Agent Eval tasks.\n`,
  "src/math.js": `export function add(a, b) {\n  return a + b;\n}\n\nexport function subtract(a, b) {\n  return a - b;\n}\n\nexport function divide(a, b) {\n  if (b === 0) {\n    return "cannot divide by zero";\n  }\n  return a / b;\n}\n`,
  "src/api.js": `export function createUser(user) {\n  if (!user || typeof user.name !== "string" || user.name.trim() === "") {\n    throw new Error("name is required");\n  }\n  return { id: nextId(), ...user };\n}\n\nlet counter = 0;\nfunction nextId() {\n  counter += 1;\n  return counter;\n}\n`,
  "src/legacy.js": `import { displayName } from "./rename-me.js";\n\nexport function greet(user) {\n  return \`Hello, \${displayName(user)}\`;\n}\n`,
  "src/rename-me.js": `export function displayName(user) {\n  return user.nickname ?? user.name;\n}\n`,
  "src/format.js": `export function formatPrice(cents) {\n  const whole = Math.floor(cents / 100);\n  const fraction = String(cents % 100).padStart(2, "0");\n  return \`\${whole}.\${fraction}\`;\n}\n`,
  "src/counter.js": `export class Counter {\n  constructor() {\n    this.value = 0;\n    this.pending = null;\n  }\n\n  async increment() {\n    const run = (this.pending ?? Promise.resolve()).then(async () => {\n      const next = this.value + 1;\n      await Promise.resolve();\n      this.value = next;\n    });\n    this.pending = run;\n    await run;\n  }\n}\n`,
  "src/inventory.js": `export function totalItems(rows) {\n  let total = 0;\n  for (const row of rows) {\n    total = total + row.qty;\n  }\n  return total;\n}\n\nexport function totalValue(rows) {\n  let total = 0;\n  for (const row of rows) {\n    total = total + row.qty * row.price;\n  }\n  return total;\n}\n`,
  "src/deps.js": `export function parseConfig(raw) {\n  if (typeof raw !== "string" || raw.trim() === "") {\n    return [];\n  }\n  return raw.split(",").map((entry) => {\n    const [key, value] = entry.split("=");\n    return { [key]: value };\n  });\n}\n`,
  "test/math.test.js": `import { test } from "node:test";\nimport assert from "node:assert/strict";\nimport { add, subtract, divide } from "../src/math.js";\n\ntest("add and subtract", () => {\n  assert.equal(add(2, 3), 5);\n  assert.equal(subtract(5, 2), 3);\n});\n\ntest("divide reports zero-division clearly", () => {\n  // Fails today: divide(1, 0) returns Infinity.\n  assert.equal(divide(1, 0), "cannot divide by zero");\n});\n`,
  "test/api.test.js": `import { test } from "node:test";\nimport assert from "node:assert/strict";\nimport { createUser } from "../src/api.js";\n\ntest("createUser rejects missing name", () => {\n  assert.throws(() => createUser({}), /name is required/);\n});\n`,
  "test/inventory.test.js": `import { test } from "node:test";\nimport assert from "node:assert/strict";\nimport { totalItems, totalValue } from "../src/inventory.js";\n\ntest("totals over rows", () => {\n  const rows = [\n    { qty: 2, price: 3 },\n    { qty: 4, price: 5 },\n  ];\n  assert.equal(totalItems(rows), 6);\n  assert.equal(totalValue(rows), 26);\n});\n`,
  "test/format.test.js": `import { test } from "node:test";\nimport assert from "node:assert/strict";\nimport { formatPrice } from "../src/format.js";\n\ntest("formats cents as currency", () => {\n  assert.equal(formatPrice(1299), "12.99");\n});\n`,
};

export interface FixtureRepo {
  root: string;
  /** Initial commit SHA — the frozen fixture identity (§43). */
  initialSha: string;
  /** Extra uncommitted change seeded for the dirty-workspace task. */
  seedDirtyWorkspace: () => Promise<void>;
}

/**
 * Task seed (§43 Fixture mutation): introduce this task's bug as a COMMITTED
 * change on top of the green baseline, so `git diff` measures only what the
 * agent did. Seeds run before the run and are part of the frozen SHA.
 */
export async function applySeed(
  root: string,
  mutations: Record<string, (content: string) => string>,
): Promise<void> {
  for (const [relative, mutate] of Object.entries(mutations)) {
    const target = path.join(root, relative);
    const current = await fs.readFile(target, "utf8");
    await fs.writeFile(target, mutate(current), "utf8");
  }
  await git(root, "add", "-A");
  await git(root, "commit", "-m", "task seed");
}

function git(cwd: string, ...args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, { cwd });
    let out = "";
    child.stdout.on("data", (chunk) => (out += chunk.toString()));
    child.stderr.on("data", (chunk) => (out += chunk.toString()));
    child.on("error", reject);
    // NOTE: no trim — `git status --porcelain` lines carry a meaningful
    // leading status column that path slicing depends on.
    child.on("close", (code) => (code === 0 ? resolve(out) : reject(new Error(out))));
  });
}

/** Create the fixture repo in a fresh temp directory and commit it. */
export async function createFixtureRepo(): Promise<FixtureRepo> {
  // NOTE: os.tmpdir() on macOS lives under /var/folders, which the tool
  // layer's system-prefix blocklist rejects; keep fixtures inside the repo
  // under eval/.tmp (gitignored) so the real path validation accepts them.
  const base = path.join(process.cwd(), "eval", ".tmp");
  await fs.mkdir(base, { recursive: true });
  const root = await fs.mkdtemp(path.join(base, "fixture-"));
  for (const [relative, content] of Object.entries(FIXTURE_FILES)) {
    const target = path.join(root, relative);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content, "utf8");
  }
  await git(root, "init", "--initial-branch=main");
  await git(root, "config", "user.email", "eval@evir.local");
  await git(root, "config", "user.name", "Evir Eval");
  await git(root, "add", "-A");
  await git(root, "commit", "-m", "fixture baseline");
  const initialSha = (await git(root, "rev-parse", "HEAD")).trim();
  return {
    root,
    initialSha,
    seedDirtyWorkspace: async () => {
      await fs.writeFile(
        path.join(root, "README.md"),
        FIXTURE_FILES["README.md"]! + "\nUser note: do not lose this line.\n",
        "utf8",
      );
    },
  };
}

/** Current HEAD SHA (used to re-freeze the identity after task seeding). */
export async function currentSha(root: string): Promise<string> {
  return (await git(root, "rev-parse", "HEAD")).trim();
}

/** Run the fixture's test suite; resolved exit code is the pass/fail truth. */
export async function runFixtureTests(root: string): Promise<{ pass: boolean; output: string }> {
  const result = await new Promise<{ code: number | null; stdout: string; stderr: string }>(
    (resolve, reject) => {
      const child = spawn("node", ["--test", "test/*.test.js"], { cwd: root });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk) => (stdout += chunk.toString()));
      child.stderr.on("data", (chunk) => (stderr += chunk.toString()));
      child.on("error", reject);
      child.on("close", (code) => resolve({ code, stdout, stderr }));
    },
  );
  return { pass: result.code === 0, output: result.stdout + result.stderr };
}

/** Changed files vs the initial commit (porcelain names, forward slashes). */
export async function changedFiles(root: string): Promise<string[]> {
  const out = await git(root, "status", "--porcelain");
  return out
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => line.slice(3).trim().replace(/\\/g, "/"));
}

/** Unified diff vs the initial commit. */
export async function fixtureDiff(root: string): Promise<string> {
  return git(root, "diff");
}
