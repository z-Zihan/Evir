import { expect, test } from "@playwright/test";
import { configurePage, isDesktop, seedFixture, conversationMessages } from "./helpers";

/**
 * §33 Browser preview e2e (harness-verifiable slice): toolbar chrome (URL
 * bar, copy-URL / open-external with correct availability), the
 * reachability-probe error card with Retry, and the App Preview status card
 * in the Preview tab. The full Start → Ready → Stop → Restart lifecycle needs
 * the native runtime and is covered by the installed-app human pass (§18).
 */

test("browser toolbar: URL bar, copy-URL and open-external buttons exist with honest states", async ({
  page,
}, testInfo) => {
  test.skip(!isDesktop(testInfo), "Panel browser is a Desktop surface");
  await configurePage(page);
  await seedFixture(page, { messages: conversationMessages() });

  await page.locator("textarea").fill("/browser");
  const palette = page.locator(".slash-palette");
  await expect(palette).toBeVisible();
  await palette.getByText("/browser", { exact: true }).click();
  await expect(page.getByRole("tabpanel", { name: /Browser/ })).toBeVisible();

  const address = page.getByRole("textbox", { name: "Enter address" });
  await expect(address).toBeVisible();
  // With no tab open yet the per-tab actions stay disabled (§17 honest states).
  await expect(page.getByRole("button", { name: "Copy URL", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Open in default browser" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Reload", exact: true })).toBeDisabled();
});

test("navigation to an unreachable host shows the error card with a retry path", async ({
  page,
}, testInfo) => {
  test.skip(!isDesktop(testInfo), "Panel browser is a Desktop surface");
  await configurePage(page);
  await seedFixture(page, { messages: conversationMessages() });

  await page.locator("textarea").fill("/browser");
  const palette = page.locator(".slash-palette");
  await expect(palette).toBeVisible();
  await palette.getByText("/browser", { exact: true }).click();
  await expect(page.getByRole("tabpanel", { name: /Browser/ })).toBeVisible();

  // Connection-refused on a closed local port: the reachability probe fails
  // deterministically (no proxy in the loop) and refuses before any webview
  // is created — the actionable error card appears (§17 failure states).
  const address = page.getByRole("textbox", { name: "Enter address" });
  await address.fill("http://127.0.0.1:9/evir-unreachable");
  await address.press("Enter");
  await expect(page.getByText(/couldn't open|failed/i).first()).toBeVisible({ timeout: 10_000 });
});

test("preview tab hosts the App Preview status card (§12/§15)", async ({ page }, testInfo) => {
  test.skip(!isDesktop(testInfo), "Workspace preview is a Desktop surface");
  // 3-column layout: at narrow widths the workspace becomes a drawer whose
  // backdrop would block the composer/palette interactions below.
  await page.setViewportSize({ width: 1600, height: 900 });
  await configurePage(page);
  // The App Preview card renders only with an active workspace root.
  await page.evaluate(() => {
    localStorage.setItem("evir-workspace", JSON.stringify(["/tmp/evir-fixture"]));
    localStorage.setItem("evir-workspace-current", "/tmp/evir-fixture");
  });
  await seedFixture(page, { messages: conversationMessages() });

  await page.locator("textarea").fill("/preview");
  const previewPalette = page.locator(".slash-palette");
  await expect(previewPalette).toBeVisible();
  await previewPalette.getByText("/preview", { exact: true }).click();
  await expect(page.getByRole("tabpanel", { name: /Preview/ })).toBeVisible();

  const card = page.locator(".app-preview-card");
  await expect(card).toBeVisible();
  await expect(card).toContainText("App preview", { ignoreCase: true });
  // Idle state names itself; the full control set renders per state.
  await expect(card.getByText("Idle", { exact: true })).toBeVisible();
  // No dev script in this harness project → no Start button to mislead with.
  await expect(card.getByRole("button", { name: /^Start/ })).toHaveCount(0);
});
