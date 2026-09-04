import { expect, test } from "@playwright/test";
import { configurePage, fixtureConversation, fixtureProvider } from "./helpers";

// Regression (2026-09-04 user report): with a long chat history the whole
// page scrolled — message sr-only labels are position:absolute without a
// positioned ancestor, so their containing block was the ICB and the 1px
// boxes extended the document scroll area by the full message-stack height.
// The fix pins sr-only to its containing-block origin; this test keeps the
// document locked to the viewport no matter how long the thread grows.
test("long conversation never scrolls the document (sr-only containment)", async ({ page }) => {
  await configurePage(page);
  const long = Array.from({ length: 60 }, (_, i) => ({
    id: `m-${i}`,
    conversationId: fixtureConversation.id,
    role: i % 2 === 0 ? ("user" as const) : ("assistant" as const),
    content:
      i % 7 === 3
        ? "```\n" + "const veryLongLine = ".padEnd(400, "x") + "1;\n```"
        : `消息 ${i}：`.padEnd(120, `内容${i % 10}`),
    status: "complete" as const,
    createdAt: 1_780_000_000_000 + i * 1000,
  }));
  await page.evaluate(
    async ({ provider, conversation, messages }) => {
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const profile = localStorage.getItem("evir:active-profile");
        const request = indexedDB.open(
          `evir:${profile && profile.length > 0 ? profile : "default"}`,
        );
        request.onerror = () => reject(request.error ?? new Error("no db"));
        request.onsuccess = () => resolve(request.result);
      });
      const transaction = database.transaction(
        ["providers", "conversations", "messages"],
        "readwrite",
      );
      transaction.objectStore("providers").put(provider);
      transaction.objectStore("conversations").put(conversation);
      for (const message of messages) transaction.objectStore("messages").put(message);
      await new Promise<void>((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error ?? new Error("seed failed"));
      });
      database.close();
    },
    { provider: fixtureProvider, conversation: fixtureConversation, messages: long },
  );
  await page.reload();
  await page.locator(".conversation-item").first().click();

  const metrics = await page.evaluate(() => {
    const doc = document.scrollingElement ?? document.documentElement;
    return {
      scrollHeight: doc.scrollHeight,
      scrollWidth: doc.scrollWidth,
      vh: window.innerHeight,
      vw: window.innerWidth,
    };
  });
  expect(metrics.scrollHeight).toBeLessThanOrEqual(metrics.vh + 1);
  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.vw + 1);
  // The composer stays docked inside the viewport — the visible symptom of
  // the report was the entire UI (header included) scrolling away.
  const composer = page.locator(".composer");
  await expect(composer).toBeVisible();
  const box = await composer.boundingBox();
  expect(box).not.toBeNull();
  expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(metrics.vh + 1);
});
