import { expect, test } from "@playwright/test";
import { mkdir, rm } from "node:fs/promises";
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
  { width: 1600, height: 1000 },
  { width: 1440, height: 900 },
  { width: 1280, height: 800 },
  { width: 1024, height: 768 },
  { width: 900, height: 700 },
  { width: 800, height: 600 },
  { width: 720, height: 800 },
];

test("captures the required responsive, theme, and language matrix", async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  const target = isDesktop(testInfo) ? "desktop" : "web";
  const output = join(process.cwd(), "artifacts", "playwright", "screenshots", target);
  await rm(output, { recursive: true, force: true });
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

  const settingsTabs = [
    "model-providers",
    "local-identity",
    "personalization",
    "switch-theme",
    "language",
    "skills",
    ...(isDesktop(testInfo) ? ["mcp"] : []),
    "memory",
    "keyboard-shortcuts",
    "usage",
    "data-and-privacy",
    "diagnostics",
    "about-evir",
  ];
  for (const language of ["en", "zh-CN"] as const) {
    for (const theme of ["light", "dark"] as const) {
      await page.evaluate(
        ({ nextLanguage, nextTheme }) => {
          localStorage.setItem("evir-language", nextLanguage);
          localStorage.setItem("evir-theme", nextTheme);
        },
        { nextLanguage: language, nextTheme: theme },
      );
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.reload();
      await page.getByRole("button", { name: /Settings|设置/i }).click();
      const navItems = page.locator(".settings-nav-item");
      await expect(navItems).toHaveCount(settingsTabs.length);
      for (const viewport of [
        { width: 1280, height: 800 },
        { width: 800, height: 600 },
      ]) {
        await page.setViewportSize(viewport);
        for (let index = 0; index < settingsTabs.length; index += 1) {
          const tab = settingsTabs[index];
          await navItems.nth(index).click();
          await expect(page.getByText(/^(Loading|加载中)$/)).toHaveCount(0);
          await page.screenshot({
            path: join(
              output,
              `settings-${tab}-${language}-${theme}-${viewport.width}x${viewport.height}.png`,
            ),
            fullPage: true,
          });
        }
      }
      await page.getByRole("button", { name: /Close|关闭/i, exact: true }).click();
    }
  }
});
