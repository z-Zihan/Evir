import { expect, test } from "@playwright/test";
import { configurePage, seedFixture } from "./helpers";

/**
 * §36 Trace e2e: a real streamed turn through the fixture provider produces a
 * trace with TTFT/chunk timing, tool spans, and the bounded visible-output
 * sample (§27). The dialog must never surface hidden reasoning (§23/§26).
 */

test("streamed turn produces a trace with metrics, timeline and visible output", async ({
  page,
}) => {
  await configurePage(page);
  await seedFixture(page, { withConversation: true });

  await page.locator("textarea").fill("Explain this fixture for tracing");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByText(/Deterministic fixture response/)).toBeVisible();

  // 运行详情 opens from the assistant message actions.
  await page.getByRole("button", { name: "Run details", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("Run details", { exact: true }).first()).toBeVisible();

  // §27: metrics cards (TTFT, chunks) and the visible-output section carrying
  // the actual streamed text — not just metadata.
  await expect(dialog.getByText("First token", { exact: true })).toBeVisible();
  await expect(dialog.getByText("Chunks", { exact: true })).toBeVisible();
  const visibleSection = dialog.locator(".trace-visible-output");
  await expect(visibleSection).toBeVisible();
  await expect(visibleSection).toContainText(/fixture/i);
  // The privacy line is explicit: no hidden chain-of-thought is recorded.
  await expect(dialog.getByText(/no hidden reasoning/i)).toBeVisible();

  // Timeline rows carry event labels and +Δ gaps.
  await expect(dialog.getByText("Timeline", { exact: true })).toBeVisible();
  await expect(dialog.locator("[data-trace-event]").first()).toBeVisible();

  // Export JSON downloads the trace document.
  const downloadPromise = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "Export JSON" }).click();
  expect((await downloadPromise).suggestedFilename()).toMatch(/^evir-trace-.*\.json$/);
});

test("trace persists across reload for its conversation", async ({ page }) => {
  await configurePage(page);
  await seedFixture(page, { withConversation: true });

  await page.locator("textarea").fill("Trace persistence check");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByText(/Deterministic fixture response/)).toBeVisible();

  // The DOM can show streamed text before the message rows are durably
  // written — wait for the store before reloading, or the reload races it.
  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          const db = await new Promise<IDBDatabase>((resolve, reject) => {
            const request = indexedDB.open(
              `evir:${localStorage.getItem("evir:active-profile") || "default"}`,
            );
            request.onerror = () => reject(request.error ?? new Error("no db"));
            request.onsuccess = () => resolve(request.result);
          });
          const count = await new Promise<number>((resolve) => {
            const request = db.transaction("messages").objectStore("messages").count();
            request.onsuccess = () => resolve(request.result);
          });
          db.close();
          return count;
        }),
      { timeout: 15_000 },
    )
    .toBeGreaterThanOrEqual(2);

  await page.reload();
  await expect(page.getByText("Local Fixture", { exact: true })).toBeVisible();
  await page.locator(".conversation-item", { hasText: "Quality verification" }).click();
  await page.getByRole("button", { name: "Run details", exact: true }).click();
  await expect(page.getByRole("dialog").getByText("Chunks", { exact: true })).toBeVisible();
});
