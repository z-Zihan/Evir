import { expect, type Page, type TestInfo } from "@playwright/test";

export const FIXED_NOW = Date.parse("2026-08-06T12:00:00+08:00");

export interface SeedMessage {
  id: string;
  conversationId: string;
  role: "user" | "assistant" | "system";
  content: string;
  status: "complete" | "streaming" | "error" | "stopped";
  errorMessage?: string;
  createdAt: number;
  attachments?: Array<Record<string, unknown>>;
  toolCalls?: Array<{ id: string; toolName: string; arguments: Record<string, unknown> }>;
  toolResults?: Array<{
    toolCallId: string;
    toolName: string;
    success: boolean;
    output: string;
    error?: string;
  }>;
}

export const fixtureProvider = {
  id: "fixture-provider",
  name: "Local Fixture",
  protocolId: "openai-chat-completions",
  baseUrl: "http://127.0.0.1:1430/v1",
  apiKey: "fixture-key-not-secret",
  modelId: "evir-fixture-model",
  modelCapabilities: {
    toolCalling: true,
    source: "probe",
    verifiedAt: FIXED_NOW,
  },
  enabled: true,
  isDefault: true,
  createdAt: FIXED_NOW,
  updatedAt: FIXED_NOW,
};

export const fixtureConversation = {
  id: "fixture-conversation",
  title: "Quality verification",
  providerId: fixtureProvider.id,
  modelId: fixtureProvider.modelId,
  createdAt: FIXED_NOW,
  updatedAt: FIXED_NOW,
};

export function isDesktop(testInfo: TestInfo): boolean {
  return testInfo.project.name.startsWith("desktop");
}

export async function configurePage(
  page: Page,
  options: { language?: "en" | "zh-CN"; theme?: "light" | "dark" | "system" } = {},
): Promise<void> {
  const language = options.language ?? "en";
  const theme = options.theme ?? "light";
  await page.addInitScript(
    ({ initialLanguage, initialTheme }) => {
      if (!localStorage.getItem("evir-language")) {
        localStorage.setItem("evir-language", initialLanguage);
      }
      if (!localStorage.getItem("evir-theme")) {
        localStorage.setItem("evir-theme", initialTheme);
      }
    },
    { initialLanguage: language, initialTheme: theme },
  );
  await page.goto("/");
  await expect(page.locator("main.workspace")).toBeVisible();
}

export async function seedFixture(
  page: Page,
  options: { messages?: SeedMessage[]; withConversation?: boolean } = {},
): Promise<void> {
  const messages = options.messages ?? [];
  const withConversation = options.withConversation ?? messages.length > 0;
  await page.evaluate(
    async ({ provider, conversation, seededMessages, createConversation }) => {
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open("evir");
        request.onerror = () => reject(request.error ?? new Error("Unable to open Evir test DB"));
        request.onsuccess = () => resolve(request.result);
      });
      const stores = ["providers", "conversations", "messages", "attachments", "usage_records"];
      const transaction = database.transaction(stores, "readwrite");
      for (const store of stores) transaction.objectStore(store).clear();
      transaction.objectStore("providers").put(provider);
      if (createConversation) transaction.objectStore("conversations").put(conversation);
      for (const message of seededMessages) transaction.objectStore("messages").put(message);
      await new Promise<void>((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = () =>
          reject(transaction.error ?? new Error("Unable to seed Evir test DB"));
        transaction.onabort = () =>
          reject(transaction.error ?? new Error("Evir test DB transaction was aborted"));
      });
      database.close();
    },
    {
      provider: fixtureProvider,
      conversation: fixtureConversation,
      seededMessages: messages,
      createConversation: withConversation,
    },
  );
  await page.reload();
  await expect(page.getByText("Local Fixture", { exact: true })).toBeVisible();
  if (withConversation) {
    const conversation = page.locator(".conversation-item", { hasText: fixtureConversation.title });
    if ((await conversation.count()) === 0) {
      await page.locator(".workspace-header .header-icon-button").click();
    }
    await conversation.click();
    await expect(page.getByRole("heading", { name: fixtureConversation.title })).toBeVisible();
    const viewport = page.viewportSize();
    if (viewport && viewport.width <= 820) {
      await page.locator(".sidebar-backdrop").click();
    }
  }
}

export function conversationMessages(): SeedMessage[] {
  return [
    {
      id: "message-user",
      conversationId: fixtureConversation.id,
      role: "user",
      content: "Review the workspace, explain the risk, and verify the result.",
      status: "complete",
      createdAt: FIXED_NOW,
    },
    {
      id: "message-assistant",
      conversationId: fixtureConversation.id,
      role: "assistant",
      content:
        "## Verification result\n\nThe existing implementation is stable. The response includes a long URL that must wrap safely: https://example.com/a/very/long/path/that/should/not/overflow/the/message/container?with=parameters\n\n| Check | Result |\n| --- | --- |\n| Types | Passed |\n| Tests | Passed |\n\n```ts\nexport const verified = true;\n```",
      status: "complete",
      createdAt: FIXED_NOW + 60_000,
    },
  ];
}

const calls = [
  ["list_directory", { path: "/workspace" }],
  ["read_file", { path: "/workspace/src/app.tsx" }],
  ["search_files", { path: "/workspace", query: "TODO" }],
  ["apply_patch", { path: "/workspace/src/app.tsx", patch: "fixture patch" }],
  ["run_command", { program: "pnpm", args: ["test"] }],
  ["git_diff", { path: "/workspace" }],
  ["read_file", { path: "/workspace/src/chat.tsx" }],
  ["read_file", { path: "/workspace/src/agent.ts" }],
  ["search_files", { path: "/workspace", query: "permission" }],
  ["apply_patch", { path: "/workspace/src/chat.tsx", patch: "second fixture patch" }],
  ["run_command", { program: "pnpm", args: ["typecheck"] }],
  ["git_status", { path: "/workspace" }],
] as const;

export function agentMessages(
  state: "complete" | "approval" | "failed" | "cancelled" = "complete",
) {
  const toolCalls = calls.map(([toolName, argumentsValue], index) => ({
    id: `tool-${index + 1}`,
    toolName,
    arguments: argumentsValue,
  }));
  const toolResults = toolCalls.flatMap((call, index) => {
    if (state === "cancelled" && index >= 4) return [];
    const base = { toolCallId: call.id, toolName: call.toolName };
    if (state === "approval" && index === 3) {
      return [
        {
          ...base,
          success: false,
          error: "permission_required",
          output: "Approval required",
        },
      ];
    }
    if (state === "failed" && index === 4) {
      return [
        {
          ...base,
          success: false,
          error: "command_failed",
          output: "Tests failed with exit code 1",
        },
      ];
    }
    return [{ ...base, success: true, output: "Fixture step passed" }];
  });
  return [
    conversationMessages()[0],
    {
      id: `message-agent-${state}`,
      conversationId: fixtureConversation.id,
      role: "assistant" as const,
      content:
        state === "failed"
          ? "The verification command failed. The completed steps are preserved below."
          : state === "cancelled"
            ? "The run was stopped. Completed steps are preserved and remaining steps were not executed."
            : "I inspected the workspace and grouped the execution evidence below.",
      status:
        state === "failed"
          ? ("error" as const)
          : state === "cancelled"
            ? ("stopped" as const)
            : ("complete" as const),
      ...(state === "failed" ? { errorMessage: "Fixture verification failed" } : {}),
      createdAt: FIXED_NOW + 60_000,
      toolCalls,
      toolResults,
    },
  ];
}

export async function collapseSidebar(page: Page): Promise<void> {
  const button = page.locator(".workspace-header .header-icon-button");
  await button.click();
  await expect(page.locator(".sidebar")).toHaveCount(0);
}
