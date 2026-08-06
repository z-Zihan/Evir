import { expect, test } from "@playwright/test";
import {
  agentMessages,
  configurePage,
  conversationMessages,
  isDesktop,
  seedFixture,
} from "./helpers";

test("no-provider state", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await configurePage(page, { language: "zh-CN", theme: "light" });
  await expect(page).toHaveScreenshot(
    `${isDesktop(testInfo) ? "desktop" : "web"}-no-provider.png`,
    {
      animations: "disabled",
    },
  );
});

test("conversation state", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 800, height: 600 });
  await configurePage(page, { language: "en", theme: "dark" });
  await seedFixture(page, {
    messages: isDesktop(testInfo) ? agentMessages("complete") : conversationMessages(),
  });
  await expect(page).toHaveScreenshot(
    `${isDesktop(testInfo) ? "desktop-agent" : "web-conversation"}.png`,
    { animations: "disabled" },
  );
});

test("settings state", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await configurePage(page, { language: "en", theme: "light" });
  await seedFixture(page);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page).toHaveScreenshot(`${isDesktop(testInfo) ? "desktop" : "web"}-settings.png`, {
    animations: "disabled",
  });
});
