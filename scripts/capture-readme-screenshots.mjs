#!/usr/bin/env node
// Captures README product screenshots from the real UI served by the local
// vite dev servers (desktop mode on :1421, web mode on :1420). Seeds a
// deterministic, secret-free demo dataset directly into IndexedDB first.
//
// Usage:
//   pnpm exec vite --mode desktop --port 1421 &
//   pnpm exec vite --mode web --port 1420 &
//   node scripts/capture-readme-screenshots.mjs
//
// Output: assets/readme/*.png (1600x1000, light theme, English UI)

import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { chromium } from "@playwright/test";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OUT_DIR = path.join(ROOT, "assets", "readme");
const DESKTOP_URL = process.env.EVIR_DESKTOP_URL ?? "http://127.0.0.1:1421";
const WEB_URL = process.env.EVIR_WEB_URL ?? "http://127.0.0.1:1420";
const VIEWPORT = { width: 1600, height: 1000 };
const NOW = Date.parse("2026-08-27T15:30:00+08:00");

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
    { id: "tool-4", toolName: "run_command", arguments: { program: "pnpm", args: ["test"] } },
    { id: "tool-5", toolName: "git_diff", arguments: {} },
  ];
  const outputs = {
    "tool-1": "612 lines read; project and chat sections identified",
    "tool-2": "14 matches across Sidebar.tsx and tests",
    "tool-3": "Extracted SidebarProjectItem and SidebarConversationItem",
    "tool-4": "636 passed in 5.3s",
    "tool-5": "3 files changed, 128 insertions(+), 96 deletions(-)",
  };
  const durations = { "tool-1": 240, "tool-2": 180, "tool-3": 420, "tool-4": 5300, "tool-5": 160 };
  const toolResults = toolCalls.map((call) => ({
    toolCallId: call.id,
    toolName: call.toolName,
    success: true,
    output: outputs[call.id],
    durationMs: durations[call.id],
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

async function seed(page, { withProjects, currentProjectId, messages }) {
  await page.evaluate(
    async ({ seedProviders, seedProjects, seedConversations, seedMessages, projectId }) => {
      localStorage.setItem("evir-language", "en");
      localStorage.setItem("evir-theme", "light");
      localStorage.setItem("evir-project-current", projectId);
      localStorage.removeItem("evir-sidebar-sort");
      localStorage.removeItem("evir-sidebar-expanded-projects");
      const database = await new Promise((resolve, reject) => {
        const request = indexedDB.open("evir");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);
      });
      const stores = [
        "projects",
        "providers",
        "conversations",
        "messages",
        "attachments",
        "usage_records",
        "memories",
        "mcpServers",
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

async function captureDesktopOverview(browser) {
  const { context, page } = await newPage(browser);
  try {
    await page.goto(DESKTOP_URL);
    await seed(page, {
      withProjects: true,
      currentProjectId: "project-evir",
      messages: agentThreadMessages(),
    });
    await page.reload();
    await page.locator('section[aria-label="Projects"]').waitFor();
    const evirRow = page.locator(".project-item", { hasText: "Evir" }).first();
    if (
      (await evirRow
        .locator(".conversation-item", { hasText: "Refactor project sidebar" })
        .count()) === 0
    ) {
      await evirRow.locator("button").first().click();
    }
    await page
      .locator(".conversation-item", { hasText: "Refactor project sidebar" })
      .first()
      .click();
    await page.getByText("Split the sidebar into focused components").waitFor();
    await page.getByText("run_command", { exact: true }).first().waitFor();
    await page.waitForTimeout(600);
    await page.screenshot({
      path: path.join(OUT_DIR, "desktop-overview.png"),
      animations: "disabled",
    });
  } finally {
    await context.close();
  }
}

async function captureProjectPermission(browser) {
  const { context, page } = await newPage(browser);
  try {
    await page.goto(DESKTOP_URL);
    await seed(page, {
      withProjects: true,
      currentProjectId: "project-evir",
      messages: agentThreadMessages(),
    });
    await page.reload();
    await page.locator('section[aria-label="Projects"]').waitFor();
    const evirRow = page.locator(".project-item", { hasText: "Evir" }).first();
    await evirRow.hover();
    await evirRow.getByRole("button", { name: /permission/i }).click();
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
  const { context, page } = await newPage(browser);
  try {
    await page.goto(DESKTOP_URL);
    await seed(page, {
      withProjects: true,
      currentProjectId: "project-evir",
      messages: agentThreadMessages(),
    });
    await page.reload();
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
  const { context, page } = await newPage(browser);
  try {
    await page.goto(WEB_URL);
    await seed(page, { withProjects: false, currentProjectId: null, messages: webChatMessages() });
    await page.reload();
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
  const browser = await launch();
  try {
    await captureDesktopOverview(browser);
    console.log("✓ desktop-overview.png");
    await captureProjectPermission(browser);
    console.log("✓ project-permission.png");
    await captureProviderSettings(browser);
    console.log("✓ provider-settings.png");
    await captureWebChat(browser);
    console.log("✓ web-chat.png");
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
