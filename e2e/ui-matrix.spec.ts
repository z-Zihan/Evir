import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import {
  agentMessages,
  collapseSidebar,
  configurePage,
  conversationMessages,
  isDesktop,
  seedFixture,
} from "./helpers";

const viewports = [
  { width: 1440, height: 900 },
  { width: 1280, height: 800 },
  { width: 1024, height: 768 },
  { width: 800, height: 600 },
  { width: 720, height: 800 },
];

test("captures the required responsive, theme, and language matrix", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const target = isDesktop(testInfo) ? "desktop" : "web";
  const output = join(process.cwd(), "artifacts", "playwright", "screenshots", target);
  await mkdir(output, { recursive: true });
  await configurePage(page);

  for (const language of ["en", "zh-CN"] as const) {
    for (const theme of ["light", "dark"] as const) {
      await page.evaluate(
        ({ nextLanguage, nextTheme }) => {
          localStorage.setItem("evir-language", nextLanguage);
          localStorage.setItem("evir-theme", nextTheme);
        },
        { nextLanguage: language, nextTheme: theme },
      );
      await seedFixture(page, {
        messages: isDesktop(testInfo) ? agentMessages("complete") : conversationMessages(),
      });
      for (const viewport of viewports) {
        await page.setViewportSize(viewport);
        await expect(page.locator("main.workspace")).toBeVisible();
        await page.screenshot({
          path: join(
            output,
            `conversation-${language}-${theme}-${viewport.width}x${viewport.height}.png`,
          ),
          fullPage: true,
        });
      }
    }
  }

  await page.setViewportSize({ width: 1280, height: 800 });
  await collapseSidebar(page);
  await page.screenshot({ path: join(output, "sidebar-collapsed.png"), fullPage: true });

  await page.locator(".workspace-header .header-icon-button").click();
  await expect(page.locator(".sidebar")).toBeVisible();
  await page.evaluate(() => {
    localStorage.setItem("evir-language", "en");
    localStorage.setItem("evir-theme", "light");
  });
  await page.reload();
  await page.getByRole("button", { name: /Settings|设置/i }).click();
  const settingsTabs = isDesktop(testInfo) ? ["Skills", "MCP", "Usage"] : ["Skills", "Usage"];
  for (const tab of settingsTabs) {
    await page.getByRole("button", { name: tab, exact: true }).click();
    await page.screenshot({
      path: join(output, `settings-${tab.toLowerCase()}.png`),
      fullPage: true,
    });
  }
});
