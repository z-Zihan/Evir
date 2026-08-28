import { expect, test } from "@playwright/test";
import { configurePage, FIXED_NOW, isDesktop, seedFixture, type SeedMessage } from "./helpers";

async function updateFixtureProvider(
  page: import("@playwright/test").Page,
  modelCapabilities: Record<string, unknown>,
): Promise<void> {
  await page.evaluate(async (capabilities) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("evir");
      request.onerror = () => reject(request.error ?? new Error("Unable to open Evir test DB"));
      request.onsuccess = () => resolve(request.result);
    });
    const transaction = database.transaction("providers", "readwrite");
    const store = transaction.objectStore("providers");
    const provider = await new Promise<Record<string, unknown>>((resolve, reject) => {
      const request = store.get("fixture-provider");
      request.onerror = () => reject(request.error ?? new Error("Unable to read provider"));
      request.onsuccess = () => resolve(request.result as Record<string, unknown>);
    });
    store.put({ ...provider, modelCapabilities: capabilities });
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () =>
        reject(transaction.error ?? new Error("Unable to update provider"));
    });
    database.close();
  }, modelCapabilities);
}

test("a 120-turn conversation compacts and remains interactive", async ({ page }) => {
  test.setTimeout(60_000);
  await configurePage(page);
  const messages: SeedMessage[] = Array.from({ length: 240 }, (_, index) => ({
    id: `long-message-${index}`,
    conversationId: "fixture-conversation",
    role: index % 2 === 0 ? ("user" as const) : ("assistant" as const),
    content: `${index === 238 ? "KEEP-LATEST-CONSTRAINT " : ""}${"long context payload ".repeat(30)}${index}`,
    status: "complete" as const,
    createdAt: FIXED_NOW + index * 1_000,
  }));
  await seedFixture(page, { messages });
  await updateFixtureProvider(page, {
    toolCalling: true,
    maxContextTokens: 20_000,
    source: "probe",
    verifiedAt: FIXED_NOW,
  });
  await page.reload();

  const composer = page.locator("textarea");
  await composer.fill("Keep KEEP-LATEST-CONSTRAINT and answer after compaction");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByText(/Deterministic fixture response/)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/KEEP-LATEST-CONSTRAINT/, { exact: false }).last()).toBeVisible();
  await expect(composer).toBeEnabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("malformed streaming data fails safely and a later request recovers", async ({ page }) => {
  await configurePage(page);
  await seedFixture(page);
  const composer = page.locator("textarea");
  await composer.fill("[invalid-sse] exercise malformed stream");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByRole("button", { name: "Retry", exact: true })).toBeVisible();
  await expect(composer).toBeEnabled();

  await composer.fill("recover after malformed stream");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByText(/Deterministic fixture response/)).toBeVisible();
});

test("rapid double send creates one user turn and one response", async ({ page }) => {
  await configurePage(page);
  await seedFixture(page);
  const composer = page.locator("textarea");
  await composer.fill("double send guard");
  const send = page.getByRole("button", { name: "Send", exact: true });
  await send.dblclick();
  await expect(page.getByText(/Deterministic fixture response/)).toBeVisible();
  await expect(page.locator(".message-user", { hasText: "double send guard" })).toHaveCount(1);
  await expect(
    page.locator(".message-assistant", { hasText: /Deterministic fixture response/ }),
  ).toHaveCount(1);
});

test("large Desktop navigation remains searchable and responsive", async ({ page }, testInfo) => {
  test.skip(!isDesktop(testInfo), "Projects are a Desktop surface");
  test.setTimeout(60_000);
  await configurePage(page);
  await seedFixture(page, { withConversation: false });
  await page.evaluate(
    async ({ now }) => {
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open("evir");
        request.onerror = () => reject(request.error ?? new Error("Unable to open Evir test DB"));
        request.onsuccess = () => resolve(request.result);
      });
      const transaction = database.transaction(["projects", "conversations"], "readwrite");
      const projects = transaction.objectStore("projects");
      const conversations = transaction.objectStore("conversations");
      for (let index = 0; index < 100; index += 1) {
        projects.put({
          id: `stress-project-${index}`,
          displayName: `Stress Project ${index}`,
          nameIsCustom: false,
          rootPath: `/tmp/stress-project-${index}`,
          canonicalRootPath: `/tmp/stress-project-${index}`,
          permissionProfile: "ask",
          additionalAccessRoots: [],
          createdAt: now + index,
          updatedAt: now + index,
          lastOpenedAt: now + index,
        });
      }
      for (let index = 0; index < 500; index += 1) {
        conversations.put({
          id: `stress-thread-${index}`,
          title: `Project thread ${index}`,
          projectId: `stress-project-${index % 100}`,
          providerId: "fixture-provider",
          modelId: "evir-fixture-model",
          createdAt: now + index,
          updatedAt: now + index,
        });
      }
      for (let index = 0; index < 1_000; index += 1) {
        conversations.put({
          id: `stress-chat-${index}`,
          title: index === 777 ? "Unique searchable conversation" : `Stress chat ${index}`,
          projectId: null,
          providerId: "fixture-provider",
          modelId: "evir-fixture-model",
          createdAt: now + index,
          updatedAt: now + index,
        });
      }
      await new Promise<void>((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = () =>
          reject(transaction.error ?? new Error("Unable to seed stress data"));
      });
      database.close();
    },
    { now: FIXED_NOW },
  );

  const startedAt = Date.now();
  await page.reload();
  const search = page.getByRole("searchbox", { name: "Search projects and chats" });
  await search.fill("Unique searchable conversation");
  await expect(page.getByText("Unique searchable conversation", { exact: true })).toBeVisible();
  expect(Date.now() - startedAt).toBeLessThan(5_000);
  await search.fill("");
  await expect(page.getByText("Stress Project 99", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
