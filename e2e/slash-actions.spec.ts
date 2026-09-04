import { expect, test } from "@playwright/test";
import { configurePage, isDesktop, seedFixture, conversationMessages } from "./helpers";

/**
 * §35 Slash action center e2e: groups, filtering (EN/中文), keyboard
 * execution, Escape dismissal, capability gating, and the high-frequency
 * actions (new conversation / model / user settings / panel surfaces).
 */

test("slash palette: groups, filtering, keyboard execution and Escape", async ({ page }) => {
  await configurePage(page);
  await seedFixture(page);

  const composer = page.locator("textarea");
  await composer.fill("/");
  const palette = page.locator(".slash-palette");
  await expect(palette).toBeVisible();
  // Core actions always exist; groups carry their headings.
  await expect(palette.getByText("/new", { exact: true })).toBeVisible();
  await expect(palette.getByText("/model", { exact: true })).toBeVisible();
  await expect(palette.getByText("Core Actions", { exact: true })).toBeVisible();
  await expect(palette.getByText("Skills", { exact: true })).toBeVisible();

  // Filtering by query and by Chinese keywords narrows toward the action
  // (cmdk's fuzzy match keeps some siblings — the exact item must survive).
  await composer.fill("/model");
  await expect(palette.getByText("/model", { exact: true })).toBeVisible();
  await expect(palette.getByText("/plan", { exact: true })).toHaveCount(0);
  await composer.fill("/模型");
  await expect(palette.getByText("/model", { exact: true })).toBeVisible();

  // No matches leaves Enter to the composer (raw "/"-text can still send).
  await composer.fill("/zzzznope");
  await expect(palette.getByText("No matching commands or skills")).toBeVisible();

  // Escape closes the palette without clearing the draft.
  await composer.fill("/");
  await expect(palette).toBeVisible();
  await composer.press("Escape");
  await expect(palette).toHaveCount(0);
  await expect(composer).toHaveValue("/");
});

test("slash palette: Enter executes /new and starts a fresh conversation", async ({ page }) => {
  await configurePage(page);
  await seedFixture(page, { messages: conversationMessages() });

  const composer = page.locator("textarea");
  await composer.fill("/");
  await expect(page.locator(".slash-palette")).toBeVisible();
  await composer.press("Enter");
  await expect(page.locator(".slash-palette")).toHaveCount(0);
  await expect(composer).toHaveValue("");
});

test("slash palette: /user opens Users settings; /model opens the model picker (desktop)", async ({
  page,
}, testInfo) => {
  await configurePage(page);
  await seedFixture(page);

  const composer = page.locator("textarea");
  await composer.fill("/user");
  const palette = page.locator(".slash-palette");
  await expect(palette).toBeVisible();
  await palette.getByText("/user", { exact: true }).click();
  const settings = page.getByRole("dialog", { name: "Settings", exact: true });
  await expect(settings).toBeVisible();
  await expect(settings.getByText("Users", { exact: true }).first()).toBeVisible();
  await page.keyboard.press("Escape");

  if (isDesktop(testInfo)) {
    await composer.fill("/model");
    const modelPalette = page.locator(".slash-palette");
    await expect(modelPalette).toBeVisible();
    await modelPalette.getByText("/model", { exact: true }).click();
    // The in-header model switcher opens (the composer keeps focus semantics).
    await expect(page.locator("[role='listbox']").first()).toBeVisible({ timeout: 5_000 });
  }
});

test("slash palette: desktop panel actions open Preview and Browser tabs", async ({
  page,
}, testInfo) => {
  test.skip(!isDesktop(testInfo), "Workspace panel is a Desktop surface");
  // 3-column layout: at narrow widths the workspace becomes a drawer whose
  // backdrop would block the composer/palette interactions below.
  await page.setViewportSize({ width: 1600, height: 900 });
  await configurePage(page);
  await seedFixture(page, { messages: conversationMessages() });

  const composer = page.locator("textarea");
  const runAction = async (query: string, label: string) => {
    await composer.fill(query);
    const palette = page.locator(".slash-palette");
    await expect(palette).toBeVisible();
    await palette.getByText(label, { exact: true }).click();
  };
  await runAction("/preview", "/preview");
  await expect(page.getByRole("tabpanel", { name: /Preview/ })).toBeVisible();

  await runAction("/browser", "/browser");
  await expect(page.getByRole("tabpanel", { name: /Browser/ })).toBeVisible();

  // Toggling again closes the panel (打开 / 关闭浏览器).
  await runAction("/browser", "/browser");
  await expect(page.locator(".workspace-panel")).toHaveCount(0);
});

test("slash palette: /compact appears with enough history and reports its outcome", async ({
  page,
}) => {
  await configurePage(page);
  // Manual compaction needs real history to summarize (8+ messages).
  const longHistory = Array.from({ length: 8 }, (_, index) => ({
    id: `compact-history-${index}`,
    conversationId: "fixture-conversation",
    role: index % 2 === 0 ? ("user" as const) : ("assistant" as const),
    content: `Compaction fixture turn ${index}: ${"context ".repeat(60)}`,
    status: "complete" as const,
    createdAt: Date.now() + index,
  }));
  await seedFixture(page, { messages: longHistory });

  const composer = page.locator("textarea");
  await composer.fill("/compact");
  const palette = page.locator(".slash-palette");
  await expect(palette).toBeVisible();
  await expect(palette.getByText("/compact", { exact: true })).toBeVisible();
  await palette.getByText("/compact", { exact: true }).click();
  await expect(
    page.getByText(/Compacting this conversation|Conversation compacted|Nothing to compact/),
  ).toBeVisible({ timeout: 15_000 });
});

test("slash palette: gated actions stay hidden on web target", async ({ page }, testInfo) => {
  test.skip(isDesktop(testInfo), "Web-only gating check");
  await configurePage(page);
  await seedFixture(page);

  await page.locator("textarea").fill("/");
  const palette = page.locator(".slash-palette");
  await expect(palette).toBeVisible();
  await expect(palette.getByText("/preview", { exact: true })).toHaveCount(0);
  await expect(palette.getByText("/browser", { exact: true })).toHaveCount(0);
  await expect(palette.getByText("/outputs", { exact: true })).toHaveCount(0);
  await expect(palette.getByText("/canvas", { exact: true })).toHaveCount(0);
});
