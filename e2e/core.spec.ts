import { expect, test } from "@playwright/test";
import { agentMessages, configurePage, isDesktop, seedFixture } from "./helpers";

test("first run and runtime capability boundaries", async ({ page }, testInfo) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  await configurePage(page);
  await expect(page.getByRole("heading", { name: /Connect your first model/i })).toBeVisible();
  if (isDesktop(testInfo)) {
    await expect(page.getByText("Local desktop mode", { exact: true })).toBeVisible();
    await expect(page.getByText("Browser chat mode", { exact: true })).toHaveCount(0);
    await expect(page.getByText("Agent", { exact: true })).toBeVisible();
    await expect(page.getByText("Ask", { exact: true })).toBeVisible();
    await expect(page.getByText("Plan", { exact: true })).toHaveCount(0);
  } else {
    await expect(page.getByText("Browser chat mode", { exact: true })).toBeVisible();
    await expect(page.getByText("Local desktop mode", { exact: true })).toHaveCount(0);
    await expect(page.getByText("Agent", { exact: true })).toHaveCount(0);
    await expect(page.getByText("Plan", { exact: true })).toHaveCount(0);
    await expect(page.getByText(/Workspace/i)).toHaveCount(0);
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Settings" })).toBeVisible();
    await expect(page.getByRole("button", { name: "MCP", exact: true })).toHaveCount(0);
  }
  expect(consoleErrors).toEqual([]);
});

test("streams a deterministic response through the production adapter", async ({ page }) => {
  await configurePage(page);
  await seedFixture(page);
  const composer = page.locator("textarea");
  await composer.fill("Explain this fixture");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByText(/Deterministic fixture response/)).toBeVisible();
  await expect(page.getByText(/production chat pipeline/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Stop", exact: true })).toHaveCount(0);
  await expect(composer).toBeEnabled();
});

test("stops an active stream and remains usable", async ({ page }) => {
  await configurePage(page);
  await seedFixture(page);
  const composer = page.locator("textarea");
  await composer.fill("[slow] verify cancellation");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  const stop = page.getByRole("button", { name: "Stop", exact: true });
  await expect(stop).toBeVisible();
  await expect(page.getByText(/deliberately streamed/)).toBeVisible();
  await stop.click();
  await expect(page.getByText("stopped", { exact: true })).toBeVisible();
  await expect(composer).toBeEnabled();
});

test("maps provider errors without crashing and offers retry", async ({ page }) => {
  await configurePage(page);
  await seedFixture(page);
  await page.locator("textarea").fill("[auth-error] fail safely");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByText(/Authentication failed/i)).toBeVisible();
  await expect(page.getByRole("button", { name: /Retry/i })).toBeVisible();
  await expect(page.locator("main.workspace")).toBeVisible();
});

test("groups multi-tool activity and shows one approval surface", async ({ page }, testInfo) => {
  test.skip(!isDesktop(testInfo), "Desktop capability UI only");
  await configurePage(page);
  await seedFixture(page, { messages: agentMessages("approval") });
  await expect(page.locator(".agent-activity")).toHaveCount(1);
  await expect(page.locator(".execution-step")).toHaveCount(3);
  await expect(page.locator(".approval-panel")).toHaveCount(1);
  await expect(page.getByRole("button", { name: /Allow once/i })).toHaveCount(1);
  await expect(page.locator(".agent-activity pre")).toHaveCount(0);
});
