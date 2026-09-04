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
          fullPage: false,
        });
      }
    }
  }

  await page.setViewportSize({ width: 1280, height: 800 });
  await collapseSidebar(page);
  await page.screenshot({ path: join(output, "sidebar-collapsed.png"), fullPage: false });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: /Show sidebar|显示侧边栏/i }).click();
  await page.screenshot({ path: join(output, "sidebar-compact-open.png"), fullPage: false });
  await page.locator(".sidebar-close").click();

  const settingsTabs = [
    "model-providers",
    // "local-identity" became the multi-profile "users" panel; "plugins" is new.
    "users",
    "personalization",
    "switch-theme",
    "language",
    "skills",
    ...(isDesktop(testInfo) ? ["mcp", "browser", "plugins"] : []),
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
        { width: 390, height: 844 },
      ]) {
        await page.setViewportSize(viewport);
        for (let index = 0; index < settingsTabs.length; index += 1) {
          const tab = settingsTabs[index];
          if (viewport.width <= 900) {
            await page.locator(".settings-mobile-select").selectOption({ index });
          } else {
            await navItems.nth(index).click();
          }
          await expect(page.getByText(/^(Loading|加载中)$/)).toHaveCount(0);
          await page.screenshot({
            path: join(
              output,
              `settings-${tab}-${language}-${theme}-${viewport.width}x${viewport.height}.png`,
            ),
            fullPage: false,
          });
        }
      }
      await page.getByRole("button", { name: /Close|关闭/i, exact: true }).click();
    }
  }

  if (isDesktop(testInfo)) {
    await page.evaluate(() => {
      localStorage.setItem("evir-language", "en");
      localStorage.setItem("evir-theme", "light");
    });
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.reload();
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    const settings = page.getByRole("dialog", { name: "Settings", exact: true });
    await settings.getByRole("button", { name: "MCP", exact: true }).click();
    await settings.getByRole("button", { name: "Add server", exact: true }).first().click();
    const serverDialog = page.getByRole("dialog", { name: "Add MCP server", exact: true });
    await serverDialog.getByLabel("Name *").fill("Native fixture with a bounded long name");
    await serverDialog.getByLabel("Command *").fill("/usr/local/bin/node");
    await serverDialog
      .getByLabel("Arguments")
      .fill("/tmp/evir-mcp-stdio-fixture.mjs, --deterministic");
    await serverDialog.getByLabel("Working directory").fill("/tmp");
    await serverDialog.getByRole("button", { name: "Save", exact: true }).click();
    await expect(settings.getByText("Disabled", { exact: true }).first()).toBeVisible();
    await page.screenshot({
      path: join(output, "settings-mcp-configured-1280x800.png"),
      fullPage: false,
    });

    await page.setViewportSize({ width: 390, height: 844 });
    await settings.getByRole("button", { name: "Test connection", exact: true }).click();
    await expect(settings.getByRole("alert")).toContainText("Connection test failed");
    await page.screenshot({
      path: join(output, "settings-mcp-connection-error-390x844.png"),
      fullPage: false,
    });
    await settings.getByRole("button", { name: "Close", exact: true }).click();
  }

  await page.setViewportSize({ width: 800, height: 600 });
  await page.getByRole("button", { name: /Show sidebar|显示侧边栏/i }).click();
  await page
    .locator(".sidebar")
    .getByRole("button", { name: /Settings|设置/i, exact: true })
    .click();
  await page
    .getByRole("dialog", { name: /Settings|设置/i, exact: true })
    .getByRole("button", { name: /Edit|编辑/i, exact: true })
    .click();
  await page.screenshot({
    path: join(output, "provider-tool-calling-800x600.png"),
    fullPage: false,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: join(output, "provider-tool-calling-390x844.png"),
    fullPage: false,
  });
});
