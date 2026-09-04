import { expect, test, type Page } from "@playwright/test";
import { configurePage, FIXED_NOW, isDesktop, seedFixture, type SeedMessage } from "./helpers";

/**
 * §34 File preview e2e: typed renderers for markdown / JSON / CSV / HTML via
 * the artifact path (structured storage — the same viewer real files use),
 * the Code↔Preview toggle, and the Outputs → Preview journey (§22).
 */

const PREVIEWABLE: SeedMessage = {
  id: "message-previewable",
  conversationId: "fixture-conversation",
  role: "assistant",
  content: [
    "Here are the deliverables:",
    "",
    "```markdown",
    "# Release notes",
    "",
    "- typed **renderers** for every artifact",
    "",
    "| Area | Status |",
    "| --- | --- |",
    "| Markdown | Passed |",
    "```",
    "",
    "```json",
    '{ "renderer": "json-tree", "nested": { "ok": true }, "items": [1, 2, 3] }',
    "```",
    "",
    "```csv",
    "area,renderer,status\nmarkdown,rendered,passed\ncsv,table,passed",
    "```",
    "",
    "```html",
    "<!doctype html><html><body><h1>Fixture page</h1><p>HTML preview works</p></body></html>",
    "```",
  ].join("\n"),
  status: "complete",
  createdAt: FIXED_NOW + 60_000,
};

async function openFirstBlockInWorkspace(page: Page, language: string): Promise<void> {
  const block = page
    .locator(".code-block-view")
    .filter({ has: page.locator(`.code-block-language:text-is("${language}")`) })
    .first();
  await block.getByRole("button", { name: "Open in workspace" }).click();
  await expect(page.locator(".workspace-panel")).toBeVisible();
}

test("markdown artifact renders with a raw-source toggle", async ({ page }, testInfo) => {
  test.skip(!isDesktop(testInfo), "Workspace preview is a Desktop surface");
  // 3-column layout: the drawer mode at narrow widths hides the mode toggle.
  await page.setViewportSize({ width: 1600, height: 900 });
  await configurePage(page);
  await seedFixture(page, { messages: [PREVIEWABLE] });

  await openFirstBlockInWorkspace(page, "markdown");
  const body = page.locator(".workspace-preview-tab");
  // Rendered by default: heading + table are real DOM, not source text.
  await expect(body.getByRole("heading", { name: "Release notes" })).toBeVisible();
  await expect(body.locator("table").first()).toBeVisible();
  // §23: switching to the raw source shows the fence content verbatim.
  await page.locator(".workspace-mode-toggle").getByRole("tab", { name: "Code" }).click();
  await expect(
    body.locator(".workspace-code-pre, .workspace-code-highlight").first(),
  ).toContainText("typed **renderers**");
  await page.locator(".workspace-mode-toggle").getByRole("tab", { name: "Rendered" }).click();
  await expect(body.getByRole("heading", { name: "Release notes" })).toBeVisible();
});

test("json artifact renders as a tree and csv as a table", async ({ page }, testInfo) => {
  test.skip(!isDesktop(testInfo), "Workspace preview is a Desktop surface");
  // 3-column layout: the drawer mode at narrow widths hides the mode toggle.
  await page.setViewportSize({ width: 1600, height: 900 });
  await configurePage(page);
  await seedFixture(page, { messages: [PREVIEWABLE] });

  await openFirstBlockInWorkspace(page, "json");
  const body = page.locator(".workspace-preview-tab");
  await expect(body).toContainText("json-tree");
  await expect(body).toContainText("nested");

  await openFirstBlockInWorkspace(page, "csv");
  await expect(body.locator("table").first()).toBeVisible();
  await expect(body.locator("table").first()).toContainText("rendered");
});

test("html artifact renders inside the sandboxed preview", async ({ page }, testInfo) => {
  test.skip(!isDesktop(testInfo), "Workspace preview is a Desktop surface");
  // 3-column layout: the drawer mode at narrow widths hides the mode toggle.
  await page.setViewportSize({ width: 1600, height: 900 });
  await configurePage(page);
  await seedFixture(page, { messages: [PREVIEWABLE] });

  await openFirstBlockInWorkspace(page, "html");
  // Untrusted HTML renders inside the sandboxed frame — its text is not part
  // of the host DOM, so assert the frame itself.
  const frame = page.locator(".workspace-preview-tab iframe");
  await expect(frame).toBeVisible();
});

test("outputs row opens the preview pane and carries its type chip (§22)", async ({
  page,
}, testInfo) => {
  test.skip(!isDesktop(testInfo), "Desktop Agent UI only");
  await page.setViewportSize({ width: 1600, height: 900 });
  await configurePage(page);
  await seedFixture(page, { messages: [] });

  // Seed one report_output run deliverable (same shape the executor writes).
  await page.evaluate(async () => {
    localStorage.setItem("evir-workspace", JSON.stringify(["/tmp/evir-fixture"]));
    localStorage.setItem("evir-workspace-current", "/tmp/evir-fixture");
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const profile = localStorage.getItem("evir:active-profile");
      const request = indexedDB.open(`evir:${profile && profile.length > 0 ? profile : "default"}`);
      request.onerror = () => reject(request.error ?? new Error("Unable to open Evir test DB"));
      request.onsuccess = () => resolve(request.result);
    });
    const stores = ["conversations", "messages", "agentRuns"];
    const transaction = database.transaction(stores, "readwrite");
    transaction.objectStore("conversations").put({
      id: "fixture-conversation",
      title: "Quality verification",
      providerId: "fixture-provider",
      modelId: "evir-fixture-model",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    transaction.objectStore("messages").put({
      id: "message-report",
      conversationId: "fixture-conversation",
      role: "assistant",
      content: "Deliverable registered.",
      status: "complete",
      createdAt: Date.now(),
    });
    transaction.objectStore("agentRuns").put({
      id: "agent-run-output-preview",
      conversationId: "fixture-conversation",
      status: "completed",
      toolCalls: [
        { id: "run-tool-1", toolName: "report_output", arguments: { path: "report.md" } },
      ],
      toolResults: [
        {
          toolCallId: "run-tool-1",
          toolName: "report_output",
          success: true,
          output: JSON.stringify({
            reported: true,
            path: "/tmp/evir-fixture/report.md",
            size: 128,
          }),
        },
      ],
      snapshots: [],
      fileReferences: [],
      verificationEvidence: [],
      resolution: { complete: true, reason: "Verified" },
      maxIterationsReached: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () =>
        reject(transaction.error ?? new Error("Unable to seed Evir test DB"));
    });
    database.close();
  });
  await page.reload();
  await page.locator(".conversation-item", { hasText: "Quality verification" }).click();
  await page.getByRole("button", { name: "Open workspace" }).click();
  await page.getByRole("tab", { name: /Outputs/ }).click();
  const row = page.locator(".workspace-output-row-primary", { hasText: "report.md" });
  await expect(row).toBeVisible();
  await expect(row.getByText("MD", { exact: true })).toBeVisible();
  await row.click();
  // Clicking an output lands in the Preview tab (§13 trigger path). The file
  // itself is outside the sandbox harness, so the honest outcome is the
  // bounded error state — never a silent no-op.
  await expect(page.getByRole("tabpanel", { name: /Preview/ })).toBeVisible();
});
