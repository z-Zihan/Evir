import { chromium } from "@playwright/test";

const FIXED_NOW = Date.now();

const fixtureProvider = {
  id: "fixture-provider",
  name: "Local Fixture",
  protocolId: "openai-chat-completions",
  baseUrl: "http://127.0.0.1:1430/v1",
  apiKey: "fixture-key-not-secret",
  modelId: "evir-fixture-model",
  modelCapabilities: { toolCalling: true, source: "probe", verifiedAt: FIXED_NOW },
  enabled: true,
  isDefault: true,
  createdAt: FIXED_NOW,
  updatedAt: FIXED_NOW,
};

const fixtureConversation = {
  id: "fixture-conversation",
  title: "Quality verification",
  providerId: fixtureProvider.id,
  modelId: fixtureProvider.modelId,
  createdAt: FIXED_NOW,
  updatedAt: FIXED_NOW,
};

const messages = [
  {
    id: "m1",
    conversationId: "fixture-conversation",
    role: "user",
    content: "Audit the fixture project and write the release report.",
    status: "complete",
    createdAt: FIXED_NOW - 90_000,
  },
  {
    id: "m2",
    conversationId: "fixture-conversation",
    role: "assistant",
    content: "",
    status: "complete",
    createdAt: FIXED_NOW - 80_000,
    toolCalls: [
      { id: "t1", toolName: "list_directory", arguments: { path: "/tmp/fixture" } },
      { id: "t2", toolName: "read_file", arguments: { path: "/tmp/fixture/README.md" } },
    ],
    toolResults: [
      { toolCallId: "t1", toolName: "list_directory", success: true, output: "README.md\nsrc/\n" },
      { toolCallId: "t2", toolName: "read_file", success: true, output: "# Fixture" },
    ],
  },
  {
    id: "m3",
    conversationId: "fixture-conversation",
    role: "assistant",
    content:
      "## Audit summary\n\nThe project structure is healthy. **12 files** inspected, no blockers found.\n\n- Layout uses the shared shell\n- Tests are green\n\n```ts\nconst ok = true;\n```",
    status: "complete",
    createdAt: FIXED_NOW - 60_000,
  },
  {
    id: "m4",
    conversationId: "fixture-conversation",
    role: "user",
    content:
      "Thanks! Now write the final report with an extremely long unbroken token to verify overflow behaviour aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa and a URL https://example.com/some/very/long/path/that/should/wrap/correctly?with=query&params=true",
    status: "complete",
    createdAt: FIXED_NOW - 40_000,
  },
  {
    id: "m5",
    conversationId: "fixture-conversation",
    role: "assistant",
    content: "The final report is ready for review.",
    status: "complete",
    createdAt: FIXED_NOW - 30_000,
  },
];

async function seed(page) {
  await page.addInitScript(
    ({ provider, conversation, messages }) => {
      const request = indexedDB.open("evir");
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains("providers"))
          db.createObjectStore("providers", { keyPath: "id" });
        if (!db.objectStoreNames.contains("conversations"))
          db.createObjectStore("conversations", { keyPath: "id" });
        if (!db.objectStoreNames.contains("messages"))
          db.createObjectStore("messages", { keyPath: "id" });
      };
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction(["providers", "conversations", "messages"], "readwrite");
        tx.objectStore("providers").put(provider);
        tx.objectStore("conversations").put(conversation);
        for (const m of messages) tx.objectStore("messages").put(m);
      };
    },
    { provider: fixtureProvider, conversation: fixtureConversation, messages },
  );
}

const theme = process.argv[2] ?? "light";
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
await seed(p);
await p.addInitScript(
  ({ theme }) => {
    localStorage.setItem("evir-language", "en");
    localStorage.setItem("evir-theme", theme);
  },
  { theme },
);
await p.goto("http://localhost:5199/", { waitUntil: "networkidle" });
await p.waitForTimeout(1200);
await p.locator(".conversation-item").first().click();
await p.waitForTimeout(600);
await p.screenshot({ path: `/tmp/ui-audit-${theme}.png` });
await b.close();
console.log("done", theme);
