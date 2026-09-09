#!/usr/bin/env node
// Captures README product screenshots from the real UI served by the local
// vite dev servers (desktop mode on :1421, web mode on :1420). Seeds a
// deterministic, secret-free demo dataset directly into the profile-scoped
// IndexedDB database (evir:default) first.
//
// Usage:
//   pnpm exec vite --mode desktop --port 1421 &
//   pnpm exec vite --mode web --port 1420 &
//   node scripts/capture-readme-screenshots.mjs
//
// Output: assets/readme/*.png (1600x1000, light theme, English UI)
//   desktop-overview.png    project thread + Context Workbench (Changes tab)
//   plan-confirm.png        structured plan awaiting confirmation
//   goal-progress.png       Goal mode banner + live plan
//   knowledge-settings.png  Knowledge Base bases + sources
//   project-permission.png  per-project permission dialog
//   provider-settings.png   provider list with capability tiers
//   web-chat.png            web (chat-only) surface

import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { chromium } from "@playwright/test";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OUT_DIR = path.join(ROOT, "assets", "readme");
const DESKTOP_URL = process.env.EVIR_DESKTOP_URL ?? "http://127.0.0.1:1421";
const WEB_URL = process.env.EVIR_WEB_URL ?? "http://127.0.0.1:1420";
const VIEWPORT = { width: 1600, height: 1000 };
const NOW = Date.parse("2026-09-09T15:30:00+08:00");

const providers = [
  {
    id: "provider-glm",
    name: "Zhipu GLM",
    protocolId: "openai-chat-completions",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    apiKey: "",
    modelId: "glm-4.7",
    modelCapabilities: { toolCalling: true, source: "user", verifiedAt: NOW },
    enabled: true,
    isDefault: true,
    createdAt: NOW - 90 * 86400_000,
    updatedAt: NOW - 2 * 86400_000,
  },
  {
    id: "provider-openai",
    name: "OpenAI",
    protocolId: "openai-chat-completions",
    baseUrl: "https://api.openai.com/v1",
    apiKey: "",
    modelId: "gpt-4o",
    modelCapabilities: { toolCalling: true, source: "user", verifiedAt: NOW - 30 * 86400_000 },
    enabled: true,
    isDefault: false,
    createdAt: NOW - 60 * 86400_000,
    updatedAt: NOW - 9 * 86400_000,
  },
  {
    id: "provider-deepseek",
    name: "DeepSeek",
    protocolId: "openai-compatible-chat",
    baseUrl: "https://api.deepseek.com/v1",
    apiKey: "",
    modelId: "deepseek-chat",
    modelCapabilities: { toolCalling: false, source: "metadata" },
    enabled: true,
    isDefault: false,
    createdAt: NOW - 20 * 86400_000,
    updatedAt: NOW - 5 * 86400_000,
  },
];

const projects = [
  {
    id: "project-evir",
    displayName: "Evir",
    nameIsCustom: false,
    rootPath: "/Users/demo/dev/evir",
    canonicalRootPath: "/Users/demo/dev/evir",
    pinned: NOW,
    permissionProfile: "ask",
    additionalAccessRoots: [],
    createdAt: NOW - 40 * 86400_000,
    updatedAt: NOW - 3600_000,
    lastOpenedAt: NOW - 600_000,
  },
  {
    id: "project-chorus",
    displayName: "Chorus",
    nameIsCustom: false,
    rootPath: "/Users/demo/dev/chorus",
    canonicalRootPath: "/Users/demo/dev/chorus",
    permissionProfile: "workspace",
    additionalAccessRoots: [],
    createdAt: NOW - 15 * 86400_000,
    updatedAt: NOW - 3 * 86400_000,
    lastOpenedAt: NOW - 2 * 86400_000,
  },
];

const conversations = [
  {
    id: "thread-sidebar",
    title: "Refactor project sidebar",
    projectId: "project-evir",
    providerId: "provider-glm",
    modelId: "glm-4.7",
    pinned: NOW,
    createdAt: NOW - 7200_000,
    updatedAt: NOW - 900_000,
  },
  {
    id: "thread-plan",
    title: "Plan: split the sidebar module",
    projectId: "project-evir",
    providerId: "provider-glm",
    modelId: "glm-4.7",
    createdAt: NOW - 5400_000,
    updatedAt: NOW - 4800_000,
  },
  {
    id: "thread-goal",
    title: "Goal: stabilize the v0.3 release",
    projectId: "project-evir",
    providerId: "provider-glm",
    modelId: "glm-4.7",
    createdAt: NOW - 10800_000,
    updatedAt: NOW - 300_000,
  },
  {
    id: "thread-fallback",
    title: "Improve provider fallback",
    projectId: "project-evir",
    providerId: "provider-glm",
    modelId: "glm-4.7",
    createdAt: NOW - 2 * 86400_000,
    updatedAt: NOW - 86400_000,
  },
  {
    id: "thread-chorus",
    title: "Review agent permissions",
    projectId: "project-chorus",
    providerId: "provider-openai",
    modelId: "gpt-4o",
    createdAt: NOW - 3 * 86400_000,
    updatedAt: NOW - 2 * 86400_000,
  },
  {
    id: "chat-standalone",
    title: "Naming ideas for v0.2",
    projectId: null,
    providerId: "provider-glm",
    modelId: "glm-4.7",
    createdAt: NOW - 86400_000,
    updatedAt: NOW - 43200_000,
  },
];

function agentThreadMessages() {
  const toolCalls = [
    { id: "tool-1", toolName: "read_file", arguments: { path: "src/app/Sidebar.tsx" } },
    { id: "tool-2", toolName: "search_files", arguments: { query: "conversation-item" } },
    { id: "tool-3", toolName: "apply_patch", arguments: { path: "src/app/Sidebar.tsx" } },
    { id: "tool-4", toolName: "write_file", arguments: { path: "src/app/SidebarProjectItem.tsx" } },
    { id: "tool-5", toolName: "run_command", arguments: { program: "pnpm", args: ["test"] } },
    { id: "tool-6", toolName: "git_diff", arguments: {} },
  ];
  const outputs = {
    "tool-1": "612 lines read; project and chat sections identified",
    "tool-2": "14 matches across Sidebar.tsx and tests",
    "tool-3": "Extracted SidebarProjectItem and SidebarConversationItem",
    "tool-4": "Created src/app/SidebarProjectItem.tsx (86 lines)",
    "tool-5": "636 passed in 5.3s",
    "tool-6": "3 files changed, 128 insertions(+), 96 deletions(-)",
  };
  const durations = {
    "tool-1": 240,
    "tool-2": 180,
    "tool-3": 420,
    "tool-4": 260,
    "tool-5": 5300,
    "tool-6": 160,
  };
  const toolResults = toolCalls.map((call) => ({
    toolCallId: call.id,
    toolName: call.toolName,
    success: true,
    output: outputs[call.id],
    durationMs: durations[call.id],
    completedAt: NOW - 1200_000 + durations[call.id],
  }));
  return [
    {
      id: "message-user",
      conversationId: "thread-sidebar",
      role: "user",
      content:
        "Refactor the project sidebar and keep the existing behavior unchanged. Run the test suite before you finish.",
      status: "complete",
      createdAt: NOW - 7200_000,
    },
    {
      id: "message-assistant",
      conversationId: "thread-sidebar",
      role: "assistant",
      content: [
        "## Summary",
        "",
        "Split the sidebar into focused components without touching behavior:",
        "",
        "- Extracted `SidebarProjectItem` and `SidebarConversationItem` from the monolithic list renderer",
        "- Project rows now own their hover actions; chat rows stay unchanged",
        "- All 636 tests pass and the diff stays inside `src/app/`",
        "",
        "The run evidence is grouped below.",
      ].join("\n"),
      status: "complete",
      createdAt: NOW - 900_000,
      toolCalls,
      toolResults,
    },
  ];
}

function planThreadMessages() {
  return [
    {
      id: "plan-message-user",
      conversationId: "thread-plan",
      role: "user",
      content: "/plan Split the sidebar module into focused components. Tests must keep passing.",
      status: "complete",
      createdAt: NOW - 5400_000,
    },
  ];
}

function goalThreadMessages() {
  return [
    {
      id: "goal-message-user",
      conversationId: "thread-goal",
      role: "user",
      content:
        "/goal Stabilize the v0.3 release: the full test suite must pass, TypeScript must stay clean, and the CHANGELOG must be updated. Ask me to confirm the changelog before you call it done.",
      status: "complete",
      createdAt: NOW - 10800_000,
    },
  ];
}

/**
 * The persisted AgentRunRecord for the sidebar-refactor thread. The workspace
 * panel (Changes tab) re-derives its change list from this record's tool
 * calls + snapshot chain when the conversation is opened.
 */
function sidebarAgentRun() {
  const toolCalls = [
    { id: "tool-1", toolName: "read_file", arguments: { path: "src/app/Sidebar.tsx" } },
    { id: "tool-2", toolName: "search_files", arguments: { query: "conversation-item" } },
    { id: "tool-3", toolName: "apply_patch", arguments: { path: "src/app/Sidebar.tsx" } },
    { id: "tool-4", toolName: "write_file", arguments: { path: "src/app/SidebarProjectItem.tsx" } },
    {
      id: "tool-5",
      toolName: "write_file",
      arguments: { path: "src/app/SidebarConversationItem.tsx" },
    },
    { id: "tool-6", toolName: "run_command", arguments: { program: "pnpm", args: ["test"] } },
  ];
  const toolResults = toolCalls.map((call, index) => ({
    toolCallId: call.id,
    toolName: call.toolName,
    success: true,
    output: "ok",
    durationMs: 200 + index * 90,
    completedAt: NOW - 1200_000 + index * 90,
  }));
  return {
    id: "run-sidebar-1",
    conversationId: "thread-sidebar",
    status: "completed",
    toolCalls,
    toolResults,
    snapshots: [
      {
        snapshot_id: "snap-1",
        file_path: "/Users/demo/dev/evir/src/app/Sidebar.tsx",
        existed: true,
        original_hash: "b3f9c2",
      },
      {
        snapshot_id: "snap-2",
        file_path: "/Users/demo/dev/evir/src/app/SidebarProjectItem.tsx",
        existed: false,
        original_hash: null,
      },
      {
        snapshot_id: "snap-3",
        file_path: "/Users/demo/dev/evir/src/app/SidebarConversationItem.tsx",
        existed: false,
        original_hash: null,
      },
    ],
    fileReferences: [],
    verificationEvidence: [],
    resolution: { complete: true, reason: "all steps verified" },
    maxIterationsReached: false,
    startedAt: NOW - 1500_000,
    completedAt: NOW - 1100_000,
    durationMs: 400_000,
    createdAt: NOW - 1500_000,
    updatedAt: NOW - 900_000,
  };
}

function planNode(id, kind, title, objective, dependencies, status) {
  return {
    id,
    kind,
    title,
    objective,
    dependencies,
    requiredCapabilities: ["filesystem"],
    resourceScopes: [{ kind: "workspace", value: "src/app", access: "read" }],
    expectedArtifacts: [],
    successCriteria: ["Step objective met"],
    status,
  };
}

/** Orchestration snapshot for thread-plan: plan awaiting confirmation. */
function planConfirmationRecords() {
  const brief = {
    id: "brief-plan-1",
    runId: "run-plan-1",
    conversationId: "thread-plan",
    goalKind: "change",
    objective: "Split the sidebar module into focused components without behavior changes",
    constraints: ["Keep all 636 tests passing", "Do not touch files outside src/app/"],
    deliverables: [
      "src/app/SidebarProjectItem.tsx",
      "src/app/SidebarConversationItem.tsx",
      "updated sidebar tests",
    ],
    acceptanceCriteria: ["pnpm test exits 0", "sidebar renders identically"],
    requiredCapabilities: ["filesystem", "terminal"],
    assumptions: [
      { id: "a-1", statement: "Existing tests cover sidebar behavior", source: "inferred" },
    ],
    unknowns: [],
    risk: "low",
    clarificationRound: 1,
    version: 1,
    createdAt: NOW - 5400_000,
    updatedAt: NOW - 4800_000,
  };
  const plan = {
    id: "plan-1",
    runId: "run-plan-1",
    conversationId: "thread-plan",
    briefVersion: 1,
    revision: 1,
    nodes: [
      planNode(
        "n-1",
        "task",
        "Map the sidebar structure",
        "Read Sidebar.tsx and its tests; list the sections to extract",
        [],
        "completed",
      ),
      planNode(
        "n-2",
        "task",
        "Extract SidebarProjectItem",
        "Move project-row rendering into a dedicated component",
        ["n-1"],
        "completed",
      ),
      planNode(
        "n-3",
        "task",
        "Extract SidebarConversationItem",
        "Move chat-row rendering into a dedicated component",
        ["n-1"],
        "pending",
      ),
      planNode(
        "n-4",
        "verification",
        "Run the full test suite",
        "pnpm test must pass with zero failures before finishing",
        ["n-2", "n-3"],
        "pending",
      ),
    ],
    edges: [
      { from: "n-1", to: "n-2", when: "success" },
      { from: "n-1", to: "n-3", when: "success" },
      { from: "n-2", to: "n-4", when: "always" },
      { from: "n-3", to: "n-4", when: "always" },
    ],
    status: "awaiting_confirmation",
    requiresConfirmation: true,
    createdAt: NOW - 5000_000,
    updatedAt: NOW - 4800_000,
  };
  const events = [
    {
      id: "evt-p1",
      version: 1,
      type: "run.started",
      runId: "run-plan-1",
      conversationId: "thread-plan",
      timestamp: NOW - 5400_000,
      summary: "Task started",
    },
    {
      id: "evt-p2",
      version: 1,
      type: "intake.completed",
      runId: "run-plan-1",
      conversationId: "thread-plan",
      timestamp: NOW - 5300_000,
      summary: "Task brief drafted from the instruction",
    },
    {
      id: "evt-p3",
      version: 1,
      type: "plan.created",
      runId: "run-plan-1",
      conversationId: "thread-plan",
      timestamp: NOW - 4800_000,
      summary: "4-step plan drafted with a verification gate",
      nodeId: "n-1",
    },
  ];
  return { briefs: [brief], plans: [plan], events, assignments: [] };
}

/** Orchestration snapshot for thread-goal: goal in progress with done-when checklist. */
function goalProgressRecords() {
  const brief = {
    id: "brief-goal-1",
    runId: "run-goal-1",
    conversationId: "thread-goal",
    goalKind: "change",
    objective: "Stabilize the v0.3 release of Evir",
    constraints: ["No dependency upgrades", "Keep the diff inside src/app/ and docs/"],
    deliverables: ["green test suite", "clean typecheck", "updated CHANGELOG"],
    acceptanceCriteria: [],
    requiredCapabilities: ["filesystem", "terminal", "git"],
    assumptions: [],
    unknowns: [],
    risk: "medium",
    clarificationRound: 0,
    version: 1,
    doneWhen: [
      "Full test suite passes",
      "No new TypeScript errors",
      "CHANGELOG updated and confirmed",
    ],
    doneWhenResults: [
      {
        label: "Full test suite passes",
        kind: "command",
        status: "passed",
        evidence: "pnpm test — 636 passed in 5.3s",
      },
      {
        label: "No new TypeScript errors",
        kind: "command",
        status: "passed",
        evidence: "tsc --noEmit — clean",
      },
      {
        label: "CHANGELOG updated and confirmed",
        kind: "manual",
        status: "manual",
        evidence: "Waiting for your confirmation",
      },
    ],
    createdAt: NOW - 10800_000,
    updatedAt: NOW - 600_000,
  };
  const plan = {
    id: "plan-goal-1",
    runId: "run-goal-1",
    conversationId: "thread-goal",
    briefVersion: 1,
    revision: 2,
    nodes: [
      planNode(
        "g-1",
        "task",
        "Fix the failing sidebar tests",
        "Reproduce and repair the 3 regressions from the refactor",
        [],
        "completed",
      ),
      planNode(
        "g-2",
        "task",
        "Sweep TypeScript errors",
        "Resolve the strict-mode violations introduced this cycle",
        ["g-1"],
        "completed",
      ),
      planNode(
        "g-3",
        "task",
        "Draft the CHANGELOG",
        "Write user-facing entries for v0.3 and ask for confirmation",
        ["g-2"],
        "running",
      ),
      planNode(
        "g-4",
        "verification",
        "Verify done-when conditions",
        "Re-run tests and typecheck; collect evidence for each condition",
        ["g-3"],
        "pending",
      ),
    ],
    edges: [
      { from: "g-1", to: "g-2", when: "success" },
      { from: "g-2", to: "g-3", when: "success" },
      { from: "g-3", to: "g-4", when: "always" },
    ],
    status: "ready",
    requiresConfirmation: false,
    createdAt: NOW - 9000_000,
    updatedAt: NOW - 900_000,
  };
  const assignments = [
    {
      id: "asg-goal-1",
      parentRunId: "run-goal-1",
      nodeId: "g-2",
      objective: "Sweep TypeScript strict-mode errors",
      allowedTools: ["read_file", "apply_patch", "run_command"],
      resourceScopes: [{ kind: "workspace", value: "src/app", access: "write" }],
      contextReferences: [],
      expectedOutputSchema: {},
      budget: { maxTurns: 12 },
      depth: 1,
      status: "completed",
      createdAt: NOW - 5400_000,
      updatedAt: NOW - 2400_000,
    },
    {
      id: "asg-goal-2",
      parentRunId: "run-goal-1",
      nodeId: "g-3",
      objective: "Draft CHANGELOG entries for v0.3",
      allowedTools: ["read_file", "write_file"],
      resourceScopes: [{ kind: "workspace", value: "docs", access: "write" }],
      contextReferences: [],
      expectedOutputSchema: {},
      budget: { maxTurns: 8 },
      depth: 1,
      status: "running",
      createdAt: NOW - 1200_000,
      updatedAt: NOW - 600_000,
    },
  ];
  const events = [
    {
      id: "evt-g1",
      version: 1,
      type: "run.started",
      runId: "run-goal-1",
      conversationId: "thread-goal",
      timestamp: NOW - 10800_000,
      summary: "Goal started",
    },
    {
      id: "evt-g2",
      version: 1,
      type: "intake.completed",
      runId: "run-goal-1",
      conversationId: "thread-goal",
      timestamp: NOW - 10700_000,
      summary: "3 done-when conditions registered",
    },
    {
      id: "evt-g3",
      version: 1,
      type: "plan.confirmed",
      runId: "run-goal-1",
      conversationId: "thread-goal",
      timestamp: NOW - 9600_000,
      summary: "Plan revision 2 confirmed",
    },
    {
      id: "evt-g4",
      version: 1,
      type: "node.completed",
      runId: "run-goal-1",
      conversationId: "thread-goal",
      timestamp: NOW - 2400_000,
      summary: "TypeScript sweep finished — 0 errors",
      nodeId: "g-2",
    },
    {
      id: "evt-g5",
      version: 1,
      type: "node.started",
      runId: "run-goal-1",
      conversationId: "thread-goal",
      timestamp: NOW - 1200_000,
      summary: "Drafting the CHANGELOG",
      nodeId: "g-3",
    },
  ];
  return { briefs: [brief], plans: [plan], events, assignments };
}

const knowledgeBases = [
  {
    id: "kb-evir-docs",
    name: "Evir product docs",
    description: "Product specs and architecture notes bound to the Evir project",
    enabled: true,
    createdAt: NOW - 12 * 86400_000,
    updatedAt: NOW - 3600_000,
  },
  {
    id: "kb-research",
    name: "Research clippings",
    description: "Web notes kept for background research",
    enabled: true,
    createdAt: NOW - 6 * 86400_000,
    updatedAt: NOW - 2 * 86400_000,
  },
];

function knowledgeSources() {
  const base = {
    enabled: true,
    status: "ready",
    error: undefined,
  };
  return [
    {
      ...base,
      id: "ks-project-docs",
      baseId: "kb-evir-docs",
      type: "project-docs",
      title: "docs/ — product specs",
      ref: "/Users/demo/dev/evir/docs",
      lastIndexedAt: NOW - 3600_000,
      docCount: 14,
      chunkCount: 96,
      createdAt: NOW - 12 * 86400_000,
      updatedAt: NOW - 3600_000,
    },
    {
      ...base,
      id: "ks-design",
      baseId: "kb-evir-docs",
      type: "local-folder",
      title: "Design references",
      ref: "/Users/demo/dev/evir/design",
      lastIndexedAt: NOW - 4 * 3600_000,
      docCount: 6,
      chunkCount: 31,
      createdAt: NOW - 10 * 86400_000,
      updatedAt: NOW - 4 * 3600_000,
    },
    {
      ...base,
      id: "ks-tauri",
      baseId: "kb-evir-docs",
      type: "web-url",
      title: "Tauri 2 guide",
      ref: "https://v2.tauri.app/develop/",
      lastIndexedAt: NOW - 86400_000,
      docCount: 3,
      chunkCount: 18,
      createdAt: NOW - 7 * 86400_000,
      updatedAt: NOW - 86400_000,
    },
    {
      ...base,
      id: "ks-ux",
      baseId: "kb-research",
      type: "web-url",
      title: "Agent UX patterns",
      ref: "https://example.com/agent-ux-notes",
      lastIndexedAt: NOW - 2 * 86400_000,
      docCount: 2,
      chunkCount: 9,
      createdAt: NOW - 5 * 86400_000,
      updatedAt: NOW - 2 * 86400_000,
    },
    {
      ...base,
      id: "ks-history",
      baseId: "kb-research",
      type: "historical-task",
      title: "Run: sidebar refactor (Sep 8)",
      ref: "run://thread-sidebar/run-sidebar-1",
      lastIndexedAt: NOW - 7200_000,
      docCount: 1,
      chunkCount: 5,
      createdAt: NOW - 3 * 86400_000,
      updatedAt: NOW - 7200_000,
    },
  ];
}

function webChatMessages() {
  return [
    {
      id: "web-message-user",
      conversationId: "chat-standalone",
      role: "user",
      content: "Compare structuredClone and JSON.stringify for exporting conversations.",
      status: "complete",
      createdAt: NOW - 43200_000,
    },
    {
      id: "web-message-assistant",
      conversationId: "chat-standalone",
      role: "assistant",
      content: [
        "Both serialize plain data, but they differ in what survives the round trip:",
        "",
        "| Aspect | `structuredClone` | `JSON.stringify` |",
        "| --- | --- | --- |",
        "| `undefined` values | kept as properties | dropped |",
        "| Dates | `Date` objects | ISO strings |",
        "| Circular references | supported | throws |",
        "",
        "For Evir exports the JSON path is deliberate: the file stays human-readable and diffable.",
        "",
        "```ts",
        "const exported = JSON.stringify(conversation, null, 2);",
        "```",
      ].join("\n"),
      status: "complete",
      createdAt: NOW - 43100_000,
    },
  ];
}

/**
 * Seeds the profile-scoped Dexie database (evir:default) via raw IndexedDB.
 * The app must have booted once so Dexie created the versioned stores.
 */
async function seed(
  page,
  { withProjects, currentProjectId, messages, agentRuns, orchestration, withKnowledge },
) {
  await page.evaluate(
    async (input) => {
      const {
        seedProviders,
        seedProjects,
        seedConversations,
        seedMessages,
        seedAgentRuns,
        seedOrchestration,
        seedKnowledgeBases,
        seedKnowledgeSources,
        projectId,
      } = input;
      localStorage.setItem("evir-language", "en");
      localStorage.setItem("evir-theme", "light");
      localStorage.setItem("evir-project-current", projectId);
      localStorage.removeItem("evir-sidebar-sort");
      localStorage.removeItem("evir-sidebar-expanded-projects");
      indexedDB.deleteDatabase("evir");
      // The app's Dexie connection creates the profile database with its
      // versioned stores on boot — seeding earlier would race an empty v1
      // database into existence. Wait for it, then for the stores.
      const openDatabase = () =>
        new Promise((resolve, reject) => {
          const request = indexedDB.open("evir:default");
          request.onerror = () => reject(request.error);
          request.onsuccess = () => resolve(request.result);
        });
      let database = null;
      for (let attempt = 0; attempt < 150; attempt++) {
        const names = (await indexedDB.databases()).map((entry) => entry.name);
        if (names.includes("evir:default")) {
          database = await openDatabase();
          if (database.objectStoreNames.contains("agentRuns")) break;
          database.close();
          database = null;
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      if (!database) throw new Error("evir:default database did not become ready");
      const stores = [
        "projects",
        "providers",
        "conversations",
        "messages",
        "attachments",
        "usage_records",
        "memories",
        "mcpServers",
        "settings",
        "agentRuns",
        "taskBriefs",
        "plans",
        "runSteps",
        "runEvents",
        "agentAssignments",
        "approvals",
        "toolExecutions",
        "artifacts",
        "traces",
        "plugins",
        "knowledge_bases",
        "knowledge_sources",
        "knowledge_documents",
        "knowledge_chunks",
      ];
      const transaction = database.transaction(stores, "readwrite");
      for (const store of stores) transaction.objectStore(store).clear();
      for (const provider of seedProviders) transaction.objectStore("providers").put(provider);
      if (projectId !== null) {
        for (const project of seedProjects) transaction.objectStore("projects").put(project);
      }
      for (const conversation of seedConversations) {
        transaction.objectStore("conversations").put(conversation);
      }
      for (const message of seedMessages) transaction.objectStore("messages").put(message);
      for (const run of seedAgentRuns) transaction.objectStore("agentRuns").put(run);
      if (seedOrchestration) {
        for (const brief of seedOrchestration.briefs)
          transaction.objectStore("taskBriefs").put(brief);
        for (const plan of seedOrchestration.plans) {
          transaction.objectStore("plans").put(plan);
          for (const node of plan.nodes) {
            transaction.objectStore("runSteps").put({
              ...node,
              id: `${plan.id}:${node.id}`,
              planId: plan.id,
              runId: plan.runId,
            });
          }
        }
        for (const event of seedOrchestration.events)
          transaction.objectStore("runEvents").put(event);
        for (const assignment of seedOrchestration.assignments) {
          transaction.objectStore("agentAssignments").put(assignment);
        }
      }
      if (seedKnowledgeBases) {
        for (const base of seedKnowledgeBases) transaction.objectStore("knowledge_bases").put(base);
        for (const source of seedKnowledgeSources)
          transaction.objectStore("knowledge_sources").put(source);
      }
      await new Promise((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
      });
      database.close();
    },
    {
      seedProviders: providers,
      seedProjects: withProjects ? projects : [],
      seedConversations: withProjects
        ? conversations
        : conversations.filter((conversation) => conversation.projectId === null),
      seedMessages: messages,
      seedAgentRuns: agentRuns ?? [],
      seedOrchestration: orchestration ?? null,
      seedKnowledgeBases: withKnowledge ? knowledgeBases : [],
      seedKnowledgeSources: withKnowledge ? knowledgeSources() : [],
      projectId: withProjects ? currentProjectId : null,
    },
  );
}

async function launch() {
  try {
    return await chromium.launch({ channel: "chrome" });
  } catch {
    return await chromium.launch();
  }
}

async function newPage(browser) {
  const context = await browser.newContext({
    viewport: VIEWPORT,
    locale: "en-US",
    colorScheme: "light",
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("Failed to load resource")) {
      console.warn("[console.error]", message.text());
    }
  });
  return { context, page };
}

/** Boots the app once (creating the Dexie stores), seeds, then reloads. */
async function bootSeeded(browser, url, seedOptions) {
  const { context, page } = await newPage(browser);
  await page.goto(url);
  await seed(page, seedOptions);
  await page.reload();
  return { context, page };
}

/**
 * Clicks via the DOM instead of a trusted pointer event: hover overlays in
 * the chat surface can intercept Playwright's hit-test and stall the action.
 * `text` (optional) picks the first matching element containing that text.
 */
async function domClick(page, selector, text) {
  const target = page.locator(selector, text ? { hasText: text } : undefined).first();
  await target.waitFor({ state: "visible" });
  await target.evaluate((element) => element.click());
}

async function openConversation(page, title) {
  await page.locator('section[aria-label="Projects"]').waitFor();
  const evirRow = page.locator(".project-item", { hasText: "Evir" }).first();
  if ((await evirRow.locator(".conversation-item").count()) === 0) {
    await evirRow.locator("button").first().click();
  }
  await page.locator(".conversation-item", { hasText: title }).first().click();
}

async function captureDesktopOverview(browser) {
  const { context, page } = await bootSeeded(browser, DESKTOP_URL, {
    withProjects: true,
    currentProjectId: "project-evir",
    messages: [...agentThreadMessages(), ...planThreadMessages(), ...goalThreadMessages()],
    agentRuns: [sidebarAgentRun()],
    orchestration: null,
    withKnowledge: true,
  });
  try {
    await openConversation(page, "Refactor project sidebar");
    await page.getByText("Split the sidebar into focused components").waitFor();
    // Tool activity renders collapsed — expand it so the timeline is in the shot.
    await domClick(page, ".activity-header");
    await page.getByText("run_command", { exact: true }).first().waitFor();
    // Open the Context Workbench on the Changes tab (§30): the seeded run
    // record re-derives the change list when the conversation loads.
    await domClick(page, '[aria-label="Open workspace"]');
    await domClick(page, '[role="tab"]', "Changes");
    await page.locator(".workspace-change-row").first().waitFor();
    if (process.env.EVIR_DEBUG) {
      const state = await page.evaluate(() => ({
        panel: !!document.querySelector('.workspace-panel, [aria-label="Workspace"]'),
        panelRect: document
          .querySelector('.workspace-panel, [aria-label="Workspace"]')
          ?.getBoundingClientRect()
          ?.toJSON(),
        toggleLabel: document
          .querySelector('[aria-label="Open workspace"], [aria-label="Close workspace"]')
          ?.getAttribute("aria-label"),
        changeRows: document.querySelectorAll(".workspace-change-row").length,
        projectRows: [...document.querySelectorAll(".project-item")].map((row) =>
          row.textContent.replace(/\s+/g, " ").trim().slice(0, 60),
        ),
      }));
      console.log("[debug]", JSON.stringify(state, null, 2));
    }
    await page.waitForTimeout(600);
    await page.screenshot({
      path: path.join(OUT_DIR, "desktop-overview.png"),
      animations: "disabled",
    });
  } finally {
    await context.close();
  }
}

async function capturePlanConfirm(browser) {
  const { context, page } = await bootSeeded(browser, DESKTOP_URL, {
    withProjects: true,
    currentProjectId: "project-evir",
    messages: [...planThreadMessages(), ...goalThreadMessages(), ...agentThreadMessages()],
    agentRuns: [sidebarAgentRun()],
    orchestration: planConfirmationRecords(),
    withKnowledge: true,
  });
  try {
    await openConversation(page, "Plan: split the sidebar module");
    await page.getByRole("button", { name: "Confirm and start" }).waitFor();
    await page.getByText("Extract SidebarProjectItem").waitFor();
    await page.waitForTimeout(400);
    await page.screenshot({
      path: path.join(OUT_DIR, "plan-confirm.png"),
      animations: "disabled",
    });
  } finally {
    await context.close();
  }
}

async function captureGoalProgress(browser) {
  const { context, page } = await bootSeeded(browser, DESKTOP_URL, {
    withProjects: true,
    currentProjectId: "project-evir",
    messages: [...goalThreadMessages(), ...planThreadMessages(), ...agentThreadMessages()],
    agentRuns: [sidebarAgentRun()],
    orchestration: goalProgressRecords(),
    withKnowledge: true,
  });
  try {
    await openConversation(page, "Goal: stabilize the v0.3 release");
    await page.getByText("Stabilize the v0.3 release of Evir").waitFor();
    await page.getByText("CHANGELOG updated and confirmed").waitFor();
    await page.getByText("Draft the CHANGELOG").first().waitFor();
    await page.waitForTimeout(400);
    await page.screenshot({
      path: path.join(OUT_DIR, "goal-progress.png"),
      animations: "disabled",
    });
  } finally {
    await context.close();
  }
}

async function captureKnowledgeSettings(browser) {
  const { context, page } = await bootSeeded(browser, DESKTOP_URL, {
    withProjects: true,
    currentProjectId: "project-evir",
    messages: agentThreadMessages(),
    agentRuns: [],
    orchestration: null,
    withKnowledge: true,
  });
  try {
    await page.locator('section[aria-label="Projects"]').waitFor();
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.getByRole("dialog", { name: "Settings" }).waitFor();
    await page.getByRole("button", { name: "Knowledge", exact: true }).click();
    await page.getByText("Evir product docs").first().waitFor();
    // Sources render once a base is selected.
    await page.getByRole("button", { name: /Evir product docs/ }).click();
    await page.getByText("docs/ — product specs").waitFor();
    await page.waitForTimeout(400);
    await page.screenshot({
      path: path.join(OUT_DIR, "knowledge-settings.png"),
      animations: "disabled",
    });
  } finally {
    await context.close();
  }
}

async function captureProjectPermission(browser) {
  const { context, page } = await bootSeeded(browser, DESKTOP_URL, {
    withProjects: true,
    currentProjectId: "project-evir",
    messages: agentThreadMessages(),
    agentRuns: [],
    orchestration: null,
    withKnowledge: true,
  });
  try {
    await page.locator('section[aria-label="Projects"]').waitFor();
    const evirRow = page.locator(".project-item", { hasText: "Evir" }).first();
    await evirRow.hover();
    // Permission lives in the row's hover "More actions" (…) menu.
    await domClick(page, ".project-actions [aria-label='More actions']");
    await page.getByRole("menuitem", { name: "Permission" }).click();
    await page.getByRole("dialog").waitFor();
    await page.waitForTimeout(400);
    await page.screenshot({
      path: path.join(OUT_DIR, "project-permission.png"),
      animations: "disabled",
    });
  } finally {
    await context.close();
  }
}

async function captureProviderSettings(browser) {
  const { context, page } = await bootSeeded(browser, DESKTOP_URL, {
    withProjects: true,
    currentProjectId: "project-evir",
    messages: agentThreadMessages(),
    agentRuns: [],
    orchestration: null,
    withKnowledge: true,
  });
  try {
    await page.locator('section[aria-label="Projects"]').waitFor();
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.getByRole("dialog", { name: "Settings" }).waitFor();
    await page.getByText("Zhipu GLM", { exact: true }).first().waitFor();
    await page.waitForTimeout(400);
    await page.screenshot({
      path: path.join(OUT_DIR, "provider-settings.png"),
      animations: "disabled",
    });
  } finally {
    await context.close();
  }
}

async function captureWebChat(browser) {
  const { context, page } = await bootSeeded(browser, WEB_URL, {
    withProjects: false,
    currentProjectId: null,
    messages: webChatMessages(),
    agentRuns: [],
    orchestration: null,
    withKnowledge: false,
  });
  try {
    await page.locator('section[aria-label="Chats"]').waitFor();
    await page.locator(".conversation-item", { hasText: "Naming ideas for v0.2" }).first().click();
    await page.getByText("Both serialize plain data").waitFor();
    await page.waitForTimeout(600);
    await page.screenshot({
      path: path.join(OUT_DIR, "web-chat.png"),
      animations: "disabled",
    });
  } finally {
    await context.close();
  }
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  // EVIR_ONLY=overview,knowledge … limits the run to named captures when
  // iterating on a single screenshot.
  const only = process.env.EVIR_ONLY
    ? new Set(process.env.EVIR_ONLY.split(",").map((name) => name.trim()))
    : null;
  const shots = [
    ["overview", captureDesktopOverview, "desktop-overview.png"],
    ["plan", capturePlanConfirm, "plan-confirm.png"],
    ["goal", captureGoalProgress, "goal-progress.png"],
    ["knowledge", captureKnowledgeSettings, "knowledge-settings.png"],
    ["permission", captureProjectPermission, "project-permission.png"],
    ["provider", captureProviderSettings, "provider-settings.png"],
    ["web", captureWebChat, "web-chat.png"],
  ];
  const browser = await launch();
  try {
    for (const [name, capture, file] of shots) {
      if (only && !only.has(name)) continue;
      await capture(browser);
      console.log(`✓ ${file}`);
    }
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
