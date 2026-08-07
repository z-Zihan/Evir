import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { configurePage, conversationMessages, isDesktop, seedFixture } from "./helpers";

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

test("compact sidebar and settings use the whole viewport without overflow", async ({ page }) => {
  await configurePage(page);
  await seedFixture(page);
  await page.setViewportSize({ width: 390, height: 844 });

  await page.getByRole("button", { name: "Show sidebar" }).click();
  const sidebar = page.locator(".sidebar");
  await expect(sidebar).toBeVisible();
  const sidebarBox = await sidebar.boundingBox();
  expect(sidebarBox?.x).toBe(0);
  expect(sidebarBox?.width).toBe(390);

  await sidebar.getByRole("button", { name: "Settings", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Settings" });
  const compactNavigation = dialog.locator(".settings-mobile-select");
  await expect(dialog).toBeVisible();
  await expect(compactNavigation).toBeVisible();
  await expect(dialog.locator(".settings-nav")).toBeHidden();
  await expect(dialog.getByRole("button", { name: "Close" })).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(dialog.locator(":focus")).toBeVisible();
  await expect(dialog.locator(".settings-nav :focus")).toHaveCount(0);
  await compactNavigation.selectOption("identity");
  await expect(compactNavigation).toHaveValue("identity");

  const dialogBox = await dialog.boundingBox();
  expect(dialogBox).toEqual({ x: 0, y: 0, width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  await expectNoBlockingViolations(page);

  await page.setViewportSize({ width: 900, height: 500 });
  await expect(dialog).toBeVisible();
  await expect(compactNavigation).toBeVisible();
  const shortDialogBox = await dialog.boundingBox();
  expect(shortDialogBox).toEqual({ x: 0, y: 0, width: 900, height: 500 });
});

test("nested settings dialogs trap focus and Escape closes only the top layer", async ({
  page,
}) => {
  await configurePage(page);
  await seedFixture(page);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const settingsDialog = page.getByRole("dialog", { name: "Settings", exact: true });
  const addProvider = settingsDialog.getByRole("button", { name: "Add provider", exact: true });
  await addProvider.click();

  const nestedDialog = page.getByRole("dialog", { name: "Choose a model provider" });
  await expect(nestedDialog).toBeVisible();
  await expect(
    nestedDialog.getByRole("button", { name: "Choose a model provider", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(nestedDialog.locator(".provider-preset-tile").last()).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(
    nestedDialog.getByRole("button", { name: "Choose a model provider", exact: true }),
  ).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(nestedDialog).toHaveCount(0);
  await expect(settingsDialog).toBeVisible();
  await expect(addProvider).toBeFocused();
});

test("avatar crop dialog contains focus and does not close its parent settings dialog", async ({
  page,
}) => {
  await configurePage(page);
  await seedFixture(page);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const settingsDialog = page.getByRole("dialog", { name: "Settings", exact: true });
  await settingsDialog.getByRole("button", { name: "Local identity", exact: true }).click();
  const choosePhoto = settingsDialog.getByRole("button", { name: "Choose photo", exact: true });
  await choosePhoto.focus();
  await settingsDialog.locator('input[type="file"]').setInputFiles({
    name: "avatar.png",
    mimeType: "image/png",
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64",
    ),
  });

  const cropDialog = page.getByRole("dialog", { name: "Crop avatar" });
  await expect(cropDialog).toBeVisible();
  await expect(cropDialog.getByRole("button", { name: "Close avatar crop" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(cropDialog).toHaveCount(0);
  await expect(settingsDialog).toBeVisible();
  await expect(choosePhoto).toBeFocused();
});

test("shortcut help is a keyboard-contained dialog with focus return", async ({ page }) => {
  await configurePage(page);
  await seedFixture(page);
  const composer = page.locator("textarea");
  await composer.focus();
  await page.keyboard.press(process.platform === "darwin" ? "Meta+/" : "Control+/");

  const dialog = page.getByRole("dialog", { name: "Shortcut map" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Close" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(composer).toBeFocused();
});

test("model switcher exposes keyboard listbox navigation and focus return", async ({ page }) => {
  await configurePage(page);
  await seedFixture(page);
  await page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("evir");
      request.onerror = () => reject(request.error ?? new Error("Unable to open Evir test DB"));
      request.onsuccess = () => resolve(request.result);
    });
    const transaction = database.transaction("providers", "readwrite");
    transaction.objectStore("providers").put({
      id: "fixture-provider-secondary",
      name: "Second Fixture",
      protocolId: "openai-chat-completions",
      baseUrl: "http://127.0.0.1:1430/v1",
      apiKey: "fixture-key-not-secret",
      modelId: "evir-second-model",
      modelCapabilities: {
        toolCalling: true,
        source: "probe",
        verifiedAt: Date.parse("2026-08-06T12:00:00+08:00"),
      },
      enabled: true,
      isDefault: false,
      createdAt: Date.parse("2026-08-06T12:00:00+08:00"),
      updatedAt: Date.parse("2026-08-06T12:00:00+08:00"),
    });
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error("Unable to seed provider"));
    });
    database.close();
  });
  await page.reload();

  const trigger = page.getByRole("button", { name: /Local Fixture.*evir-fixture-model/ });
  await trigger.focus();
  await page.keyboard.press("ArrowDown");
  const listbox = page.getByRole("listbox", { name: "Switch model" });
  await expect(listbox).toBeVisible();
  await expect(listbox.getByRole("option", { name: /Local Fixture/ })).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(listbox.getByRole("option", { name: /Second Fixture/ })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(listbox).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test("every reachable settings page has no serious axe violations", async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  await configurePage(page);
  await seedFixture(page);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const tabs = page.locator(".settings-nav-item");
  const expectedCount = isDesktop(testInfo) ? 13 : 12;
  await expect(tabs).toHaveCount(expectedCount);
  for (let index = 0; index < expectedCount; index += 1) {
    await tabs.nth(index).click();
    await expect(page.getByText("Loading", { exact: true })).toHaveCount(0);
    await expectNoBlockingViolations(page);
  }
});
