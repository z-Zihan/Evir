import { expect, test, type Page } from "@playwright/test";
import { configurePage, FIXED_NOW, isDesktop, seedFixture, type SeedMessage } from "./helpers";

async function send(page: Page, prompt: string): Promise<void> {
  await page.locator("textarea").fill(prompt);
  await page.getByRole("button", { name: "Send", exact: true }).click();
}

test("every reachable settings page opens and key preferences persist", async ({ page }) => {
  test.setTimeout(120_000);
  await configurePage(page);
  await seedFixture(page);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const pages = [
    ["Model providers", "Model providers"],
    ["Local identity", "Local identity"],
    ["Personalization", "Personalization"],
    ["Switch theme", "Switch theme"],
    ["Language", "Language"],
    ["Skills", "Skills"],
    ["Memory", "Memory"],
    ["Keyboard shortcuts", "Keyboard shortcuts"],
    ["Usage", "Usage"],
    ["Data and privacy", "Data and privacy"],
    ["Diagnostics", "Diagnostics"],
    ["About Evir", "About Evir"],
  ] as const;
  for (const [button, heading] of pages) {
    await page.getByRole("button", { name: button, exact: true }).click();
    await expect(page.getByRole("heading", { name: heading, exact: true }).last()).toBeVisible();
  }

  await page.getByRole("button", { name: "Switch theme", exact: true }).click();
  await page.getByRole("button", { name: /^Dark / }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Language", exact: true }).click();
  await page.getByRole("button", { name: /^Chinese / }).click();
  await expect(page.getByRole("heading", { name: "语言", exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: "设置", exact: true })).toBeVisible();
});

test("message boundary corpus and 500 messages remain contained", async ({ page }) => {
  test.setTimeout(60_000);
  await configurePage(page);
  const boundary = [
    "x",
    "A".repeat(8_000),
    "https://example.com/" + "segment/".repeat(300),
    "Unicode 中文 😀 مرحبا \u202eRTL",
    "# Markdown\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n```ts\nconst value = 1;\n```\n\n$E=mc^2$",
  ];
  const messages: SeedMessage[] = Array.from({ length: 500 }, (_, index) => ({
    id: `boundary-${index}`,
    conversationId: "fixture-conversation",
    role: index % 2 === 0 ? "user" : "assistant",
    content: boundary[index % boundary.length] ?? "x",
    status: "complete",
    createdAt: FIXED_NOW + index,
  }));
  await seedFixture(page, { messages });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator(".message-list article")).toHaveCount(500);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.locator("table").last()).toBeVisible();
  await expect(page.locator("pre code").last()).toBeVisible();
});

test("streaming does not yank a reader who scrolled upward", async ({ page }) => {
  test.setTimeout(60_000);
  await configurePage(page);
  const messages: SeedMessage[] = Array.from({ length: 80 }, (_, index) => ({
    id: `scroll-${index}`,
    conversationId: "fixture-conversation",
    role: index % 2 === 0 ? "user" : "assistant",
    content: `scroll history ${index} ${"payload ".repeat(20)}`,
    status: "complete",
    createdAt: FIXED_NOW + index,
  }));
  await seedFixture(page, { messages });
  await send(page, "[slow] keep scroll stable");
  await expect(page.getByRole("button", { name: "Stop", exact: true })).toBeVisible();
  const area = page.locator(".messages-area");
  await area.evaluate((element) => {
    element.scrollTop = 0;
    element.dispatchEvent(new Event("scroll"));
  });
  await page.waitForTimeout(450);
  expect(await area.evaluate((element) => element.scrollTop)).toBeLessThan(80);
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await expect(page.locator("textarea")).toBeEnabled();
});

for (const [marker, status] of [
  ["[auth-error]", 401],
  ["[forbidden]", 403],
  ["[not-found]", 404],
  ["[server-500]", 500],
] as const) {
  test(`provider HTTP ${status} fails visibly and leaves chat recoverable`, async ({ page }) => {
    await configurePage(page);
    await seedFixture(page);
    await send(page, `${marker} provider matrix`);
    await expect(page.getByRole("button", { name: "Retry", exact: true })).toBeVisible();
    await expect(page.locator("textarea")).toBeEnabled();
    await expect(page.locator("main.workspace")).toBeVisible();
  });
}

test("burst, disconnect, malformed, and non-stream responses recover safely", async ({ page }) => {
  await configurePage(page);
  await seedFixture(page);
  await send(page, "[burst] fast chunks");
  await expect(page.getByText(/Deterministic fixture response/)).toBeVisible();

  await send(page, "[disconnect] interrupted connection");
  await expect(page.getByRole("button", { name: "Retry", exact: true })).toBeVisible();
  await expect(page.locator("textarea")).toBeEnabled();

  await send(page, "[invalid-sse] malformed stream");
  await expect(page.getByRole("button", { name: "Retry", exact: true }).last()).toBeVisible();

  await send(page, "[no-stream] json response");
  await expect(page.locator("textarea")).toBeEnabled();
  await expect(page.locator("main.workspace")).toBeVisible();
});

test("attachment selection, removal, limits, and rejection are visible", async ({ page }) => {
  await configurePage(page);
  await seedFixture(page);
  const input = page.locator('input[type="file"]');
  await input.setInputFiles({
    name: "空白 文件.txt",
    mimeType: "text/plain",
    buffer: Buffer.from(""),
  });
  await expect(page.getByText("空白 文件.txt", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Remove attachment", exact: true }).click();
  await expect(page.getByText("空白 文件.txt", { exact: true })).toHaveCount(0);

  await input.setInputFiles({
    name: "unsupported.bin",
    mimeType: "application/octet-stream",
    buffer: Buffer.from([0, 1, 2, 3]),
  });
  await expect(page.locator(".chat-error")).toBeVisible();

  await input.setInputFiles(
    Array.from({ length: 6 }, (_, index) => ({
      name: `attachment-${index}.txt`,
      mimeType: "text/plain",
      buffer: Buffer.from(`file ${index}`),
    })),
  );
  await expect(page.locator(".pending-attachment-chip")).toHaveCount(5);
  await expect(page.locator(".chat-error")).toBeVisible();
});

test("Desktop project modes expose Plan and Goal without an Agent selector", async ({
  page,
}, testInfo) => {
  test.skip(!isDesktop(testInfo), "Project modes are a Desktop surface");
  await configurePage(page);
  await page.evaluate(() => {
    localStorage.setItem("evir-workspace", JSON.stringify(["/tmp/evir-fixture"]));
    localStorage.setItem("evir-workspace-current", "/tmp/evir-fixture");
  });
  await seedFixture(page);
  await expect(page.getByText("Agent", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Plan", exact: true }).click();
  await expect(page.getByRole("button", { name: "Plan", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.getByRole("button", { name: "Goal", exact: true }).click();
  await expect(page.getByRole("button", { name: "Goal", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});
