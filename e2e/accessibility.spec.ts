import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { configurePage, conversationMessages, seedFixture } from "./helpers";

async function expectNoBlockingViolations(page: import("@playwright/test").Page) {
  const results = await new AxeBuilder({ page }).analyze();
  const blocking = results.violations.filter(
    ({ impact }) => impact === "critical" || impact === "serious",
  );
  expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);
}

test("chat surfaces have no serious axe violations", async ({ page }) => {
  await configurePage(page);
  await expectNoBlockingViolations(page);
  await seedFixture(page, { messages: conversationMessages() });
  await expectNoBlockingViolations(page);
});

test("settings dialog supports keyboard entry and escape", async ({ page }) => {
  await configurePage(page);
  await seedFixture(page);
  const settings = page.getByRole("button", { name: "Settings", exact: true });
  await settings.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Settings" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Close" })).toBeFocused();
  await expectNoBlockingViolations(page);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(settings).toBeFocused();
});
