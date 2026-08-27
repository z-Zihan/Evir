import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
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

test("shows the platform-specific built-in Skill catalog", async ({ page }, testInfo) => {
  await configurePage(page);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Skills", exact: true }).click();

  const expectedSkillCount = isDesktop(testInfo) ? 36 : 10;
  await expect(page.locator(".skill-item")).toHaveCount(expectedSkillCount);
  await expect(page.locator(".skill-toggle input:checked")).toHaveCount(0);
  await expect(page.getByText("Desktop only", { exact: true })).toHaveCount(
    isDesktop(testInfo) ? 26 : 0,
  );

  const settings = page.getByRole("dialog", { name: "Settings" });
  await settings.getByRole("textbox", { name: "Search Skills" }).fill("Meeting Minutes");
  await expect(page.locator(".skill-item")).toHaveCount(isDesktop(testInfo) ? 1 : 0);

  if (isDesktop(testInfo)) {
    await settings.getByRole("textbox", { name: "Search Skills" }).fill("");
    await settings
      .getByRole("combobox", { name: "Filter by category" })
      .selectOption("finance-investing");
    await expect(page.locator(".skill-item")).toHaveCount(1);
    await expect(settings.getByText("Credit Risk Analysis", { exact: true })).toBeVisible();
  }
});

test("selects a disabled Skill for one message and clears it after send", async ({ page }) => {
  await configurePage(page);
  await seedFixture(page);

  await page.getByRole("button", { name: "Choose Skills for this message" }).click();
  const picker = page.getByRole("dialog", { name: "Choose Skills for this message" });
  await picker.getByRole("button", { name: /Requirements Discovery/ }).click();
  await expect(page.getByRole("button", { name: "Remove Requirements Discovery" })).toBeVisible();

  await page.locator("textarea").fill("Clarify this requirement");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByText(/Deterministic fixture response/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Remove Requirements Discovery" })).toHaveCount(0);
});

test("prevents Ask mode from selecting local-capability Skills", async ({ page }, testInfo) => {
  test.skip(!isDesktop(testInfo), "Desktop-only Skill capability boundary");
  await configurePage(page);
  await seedFixture(page);

  await page.getByRole("button", { name: "Ask", exact: true }).click();
  await page.getByRole("button", { name: "Choose Skills for this message" }).click();
  const localSkill = page
    .getByRole("dialog", { name: "Choose Skills for this message" })
    .getByRole("button", { name: /File Organization/ });
  await expect(localSkill).toBeDisabled();
  await expect(localSkill).toHaveAttribute("title", "This Skill requires Agent mode");
});

test("streams a deterministic response through the production adapter", async ({
  page,
}, testInfo) => {
  await configurePage(page);
  await seedFixture(page);
  if (isDesktop(testInfo)) await page.getByRole("button", { name: "Ask", exact: true }).click();
  const composer = page.locator("textarea");
  await composer.fill("Explain this fixture");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByText(/Deterministic fixture response/)).toBeVisible();
  await expect(page.getByText(/production chat pipeline/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Stop", exact: true })).toHaveCount(0);
  await expect(composer).toBeEnabled();
});

test("stops an active stream and remains usable", async ({ page }, testInfo) => {
  await configurePage(page);
  await seedFixture(page);
  if (isDesktop(testInfo)) await page.getByRole("button", { name: "Ask", exact: true }).click();
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

test("keeps an active response inside its originating conversation", async ({ page }, testInfo) => {
  await configurePage(page);
  await seedFixture(page, { withConversation: true });
  if (isDesktop(testInfo)) await page.getByRole("button", { name: "Ask", exact: true }).click();

  await page.locator("textarea").fill("[slow] conversation A isolation");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.locator(".message-streaming")).toContainText("deliberately streamed");

  await page.getByRole("button", { name: "New chat", exact: true }).click();
  await expect(page.getByRole("heading", { name: "New conversation" })).toBeVisible();
  await expect(page.locator(".message-streaming")).toHaveCount(0);
  await expect(page.locator(".message-content", { hasText: "deliberately streamed" })).toHaveCount(
    0,
  );

  const conversationA = page.locator(".conversation-item", { hasText: "Quality verification" });
  await conversationA.click();
  await expect(page.getByText(/deliberately streamed/)).toBeVisible({ timeout: 15_000 });

  await page.locator(".conversation-item", { hasText: "New conversation" }).click();
  await expect(page.locator(".message-content", { hasText: "deliberately streamed" })).toHaveCount(
    0,
  );
});

test("Desktop Agent renders the event-driven task workbench", async ({ page }, testInfo) => {
  test.skip(!isDesktop(testInfo), "Task orchestration is a Desktop capability");
  await configurePage(page);
  await seedFixture(page);
  const composer = page.locator("textarea");
  await composer.fill("Explain this fixture");
  await page.getByRole("button", { name: "Send", exact: true }).click();

  await expect(page.getByText("Task finished", { exact: true })).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "Show execution details" }).click();
  await expect(page.getByText("Execution plan", { exact: true })).toBeVisible();
  await expect(page.getByText("Answer", { exact: true })).toBeVisible();
  await expect(page.getByText("Run summary", { exact: true })).toBeVisible();
  await expect(
    page.getByText("This answer-only task did not require local verification.", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/Deterministic fixture response/)).toBeVisible();

  for (const viewport of [
    { width: 390, height: 844 },
    { width: 900, height: 500 },
    { width: 1600, height: 1000 },
  ]) {
    await page.setViewportSize(viewport);
    const workbench = page.locator(".task-workbench");
    await expect(workbench).toBeVisible();
    const bounds = await workbench.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds?.x ?? -1).toBeGreaterThanOrEqual(0);
    expect((bounds?.x ?? 0) + (bounds?.width ?? viewport.width + 1)).toBeLessThanOrEqual(
      viewport.width,
    );
    const assistantContent = await page.locator(".message-assistant .message-main").boundingBox();
    expect(assistantContent).not.toBeNull();
    expect(Math.abs((bounds?.x ?? 0) - (assistantContent?.x ?? 0))).toBeLessThanOrEqual(1);
    expect(bounds?.width ?? 821).toBeLessThanOrEqual(820);
  }
});

test("maps provider errors without crashing and offers retry", async ({ page }) => {
  await configurePage(page);
  await seedFixture(page);
  await page.locator("textarea").fill("[auth-error] fail safely");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByText(/Authentication failed/i)).toBeVisible();
  // 消息级重试按钮（区别于任务工作台的“重试任务”）
  await expect(page.getByRole("button", { name: "Retry", exact: true })).toBeVisible();
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

test("keeps dense Agent activity compact and expandable", async ({ page }, testInfo) => {
  test.skip(!isDesktop(testInfo), "Desktop capability UI only");
  await configurePage(page);
  await seedFixture(page, { messages: agentMessages("complete") });
  const activity = page.locator(".agent-activity");
  await expect(activity.locator(".execution-step")).toHaveCount(3);
  await expect(activity.getByRole("button", { name: /Show 9 more/i })).toBeVisible();
  await activity.getByRole("button", { name: /Show 9 more/i }).click();
  await expect(activity.locator(".execution-step")).toHaveCount(12);
  await expect(activity.locator("pre:visible")).toHaveCount(0);
});

test("groups consecutive Agent replies and keeps the narrow header inside the viewport", async ({
  page,
}, testInfo) => {
  test.skip(!isDesktop(testInfo), "Desktop Agent UI only");
  await page.setViewportSize({ width: 900, height: 640 });
  await configurePage(page);
  const firstMessage = agentMessages("complete")[0];
  expect(firstMessage).toBeDefined();
  await seedFixture(page, {
    messages: [
      firstMessage,
      {
        id: "agent-step-1",
        conversationId: "fixture-conversation",
        role: "assistant",
        content: "I am checking the workspace and relevant configuration.",
        status: "complete",
        createdAt: Date.parse("2026-08-06T12:01:00+08:00"),
      },
      {
        id: "agent-step-2",
        conversationId: "fixture-conversation",
        role: "assistant",
        content: "I am running the verification command.",
        status: "complete",
        createdAt: Date.parse("2026-08-06T12:02:00+08:00"),
      },
      {
        id: "agent-step-3",
        conversationId: "fixture-conversation",
        role: "assistant",
        content: "Verification completed successfully.",
        status: "complete",
        createdAt: Date.parse("2026-08-06T12:03:00+08:00"),
      },
    ],
  });
  await page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("evir");
      request.onerror = () => reject(request.error ?? new Error("Unable to open Evir test DB"));
      request.onsuccess = () => resolve(request.result);
    });
    const transaction = database.transaction(["providers", "conversations"], "readwrite");
    transaction.objectStore("providers").put({
      id: "fixture-provider-secondary",
      name: "A second provider with a deliberately long display name",
      protocolId: "openai-responses",
      baseUrl: "http://127.0.0.1:1430/v1",
      apiKey: "fixture-key-not-secret",
      modelId: "a-deliberately-long-model-name-for-header-overflow-validation",
      enabled: true,
      isDefault: false,
      createdAt: Date.parse("2026-08-06T12:00:00+08:00"),
      updatedAt: Date.parse("2026-08-06T12:00:00+08:00"),
    });
    transaction.objectStore("conversations").put({
      id: "fixture-conversation",
      title: "A deliberately long conversation title that must truncate inside the header",
      providerId: "fixture-provider",
      modelId: "evir-fixture-model",
      createdAt: Date.parse("2026-08-06T12:00:00+08:00"),
      updatedAt: Date.parse("2026-08-06T12:03:00+08:00"),
    });
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () =>
        reject(transaction.error ?? new Error("Unable to update responsive fixtures"));
    });
    database.close();
  });
  await page.reload();
  await page
    .locator(".conversation-item", { hasText: "A deliberately long conversation title" })
    .click();

  await expect(page.locator(".message-assistant")).toHaveCount(3);
  await expect(page.locator(".message-assistant .message-role-mark")).toHaveCount(1);
  await expect(page.locator(".message-assistant .message-author")).toHaveCount(1);
  await expect(page.locator(".message-assistant.message-grouped")).toHaveCount(2);
  await expect(page.getByRole("button", { name: "Regenerate" })).toHaveCount(1);

  const headerFits = await page.locator(".workspace-header").evaluate((header) => {
    const bounds = header.getBoundingClientRect();
    const controls = header.querySelector(".workspace-controls")?.getBoundingClientRect();
    const heading = header.querySelector(".workspace-heading")?.getBoundingClientRect();
    return {
      insideViewport: bounds.left >= 0 && bounds.right <= window.innerWidth,
      controlsInsideHeader: Boolean(controls && controls.right <= bounds.right),
      columnsDoNotOverlap: Boolean(controls && heading && heading.right <= controls.left),
    };
  });
  expect(headerFits).toEqual({
    insideViewport: true,
    controlsInsideHeader: true,
    columnsDoNotOverlap: true,
  });

  await page.setViewportSize({ width: 390, height: 844 });
  const narrowHeaderFits = await page.locator(".workspace-header").evaluate((header) => {
    const bounds = header.getBoundingClientRect();
    const controls = header.querySelector(".workspace-controls")?.getBoundingClientRect();
    const heading = header.querySelector(".workspace-heading")?.getBoundingClientRect();
    return {
      insideViewport: bounds.left >= 0 && bounds.right <= window.innerWidth,
      controlsInsideHeader: Boolean(controls && controls.right <= bounds.right),
      columnsDoNotOverlap: Boolean(controls && heading && heading.right <= controls.left),
    };
  });
  expect(narrowHeaderFits).toEqual(headerFits);
});

test("shows a stable cancelled Agent state without claiming completion", async ({
  page,
}, testInfo) => {
  test.skip(!isDesktop(testInfo), "Desktop capability UI only");
  await configurePage(page);
  await seedFixture(page, { messages: agentMessages("cancelled") });
  const activity = page.locator(".agent-activity-cancelled");
  await expect(activity).toBeVisible();
  await expect(activity.getByText("stopped", { exact: true })).toBeVisible();
  await expect(activity.getByText("Completed", { exact: true })).toHaveCount(0);
  await expect(page.getByText("stopped", { exact: true })).toHaveCount(2);
});

test("conversation rename, pin, persistence, and delete form a complete loop", async ({ page }) => {
  await configurePage(page);
  await seedFixture(page, { messages: agentMessages("complete") });
  let row = page.locator(".conversation-item", { hasText: "Quality verification" });
  await row.hover();
  await row.getByRole("button", { name: "Rename" }).click();
  const rename = page.locator(".conversation-item.active .rename-input");
  await rename.fill("Renamed verification");
  await rename.press("Enter");
  row = page.locator(".conversation-item", { hasText: "Renamed verification" });
  await expect(row).toBeVisible();

  await row.hover();
  await row.getByRole("button", { name: "Pin" }).click();
  row = page.locator(".conversation-item", { hasText: "Renamed verification" });
  await expect(row.getByRole("button", { name: "Unpin" })).toBeAttached();
  await page.reload();
  row = page.locator(".conversation-item", { hasText: "Renamed verification" });
  await expect(row.getByRole("button", { name: "Unpin" })).toBeAttached();

  await row.hover();
  await row.getByRole("button", { name: "Delete" }).click();
  const confirmation = page.getByRole("alertdialog", { name: "Delete this item?" });
  await expect(confirmation).toBeVisible();
  await confirmation.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(row).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "New conversation" })).toBeVisible();
});

test("provider edits persist after closing settings and refreshing", async ({ page }) => {
  await configurePage(page);
  await seedFixture(page);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const settings = page.getByRole("dialog", { name: "Settings", exact: true });
  // Settings panels load lazily; wait for the providers panel to render.
  await expect(
    settings.locator(".provider-connection-row", { hasText: "Local Fixture" }),
  ).toBeVisible();
  const providerRow = settings.locator(".provider-connection-row", { hasText: "Local Fixture" });
  await providerRow.getByRole("button", { name: "Edit", exact: true }).click();
  const form = page.getByRole("dialog", { name: "Edit model provider" });
  await form.getByLabel(/^Name/).fill("Renamed Fixture");
  await form.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(settings.getByText("Renamed Fixture", { exact: true })).toBeVisible();
  await settings.getByRole("button", { name: "Close", exact: true }).click();
  await page.reload();
  await expect(page.getByText("Renamed Fixture", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "Settings" }).getByText("Renamed Fixture"),
  ).toBeVisible();
});

test("failed provider connection is visible in redacted diagnostic logs", async ({ page }) => {
  await configurePage(page);
  await seedFixture(page);

  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const settings = page.getByRole("dialog", { name: "Settings", exact: true });
  const providerRow = settings.locator(".provider-connection-row", { hasText: "Local Fixture" });
  await providerRow.getByRole("button", { name: "Edit", exact: true }).click();

  const form = page.getByRole("dialog", { name: "Edit model provider" });
  const secret = "sk-evir-e2e-quota-key";
  await form.getByLabel(/^API Key/).fill(secret);
  await form.getByRole("button", { name: "Test connection", exact: true }).click();
  await expect(form.getByRole("status")).toContainText(
    "Connection failed: 余额不足或无可用资源包,请充值。",
  );

  await form.getByRole("button", { name: "Cancel", exact: true }).click();
  await settings.getByRole("button", { name: "Diagnostics", exact: true }).click();
  await expect(
    settings.getByText("provider.connection-test.failed: 余额不足或无可用资源包,请充值。", {
      exact: true,
    }),
  ).toBeVisible();

  const downloadPromise = page.waitForEvent("download");
  await settings.getByRole("button", { name: "Export logs", exact: true }).click();
  const download = await downloadPromise;
  const downloadPath = await download.path();
  expect(downloadPath).not.toBeNull();
  if (!downloadPath) throw new Error("Diagnostic export did not produce a local file");
  const exportedText = await readFile(downloadPath, "utf8");
  const entries = JSON.parse(exportedText) as Array<{
    event: string;
    data?: {
      errorType?: string;
      providerResponse?: Record<string, unknown>;
    };
  }>;
  const failure = entries.find((entry) =>
    entry.event.startsWith("provider.connection-test.failed"),
  );

  expect(failure).toMatchObject({
    data: {
      errorType: "RATE_LIMITED",
      providerResponse: {
        status: 429,
        code: "quota_exhausted",
        errorType: "billing_error",
        requestId: "fixture-request-429",
        responseFormat: "json",
      },
    },
  });
  expect(exportedText).not.toContain(secret);
  expect(exportedText).not.toContain("authorization");
});

test("theme selection applies immediately and persists across reload", async ({ page }) => {
  await configurePage(page);
  await seedFixture(page);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const settings = page.getByRole("dialog", { name: "Settings", exact: true });
  await settings.getByRole("button", { name: "Switch theme", exact: true }).click();
  await settings.getByRole("button", { name: /Dark/ }).click();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await settings.getByRole("button", { name: "Close", exact: true }).click();
  await page.reload();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});

test("extreme message content stays inside the viewport", async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 600 });
  await configurePage(page);
  const longWord = "W".repeat(5000);
  await seedFixture(page, {
    messages: [
      {
        id: "message-extreme-user",
        conversationId: "fixture-conversation",
        role: "user",
        content: `中文 English 😀 ${longWord}`,
        status: "complete",
        createdAt: Date.parse("2026-08-06T12:00:00+08:00"),
        attachments: [
          {
            id: "attachment-extreme",
            messageId: "message-extreme-user",
            type: "text",
            fileName: `${"very-long-file-name-".repeat(8)}.txt`,
            mimeType: "text/plain",
            size: 12,
            data: "fixture",
          },
        ],
      },
      {
        id: "message-extreme-assistant",
        conversationId: "fixture-conversation",
        role: "assistant",
        content: `# Long content\n\nhttps://example.com/${"path/".repeat(120)}\n\n| ${"Wide column ".repeat(20)} | Result |\n| --- | --- |\n| Value | Passed |\n\n\`\`\`ts\n${"const verified = true;\n".repeat(100)}\`\`\``,
        status: "complete",
        createdAt: Date.parse("2026-08-06T12:01:00+08:00"),
      },
    ],
  });

  await expect(page.locator(".message-list")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  const bounds = await page.locator("main.workspace").boundingBox();
  expect(bounds?.x ?? -1).toBeGreaterThanOrEqual(0);
  expect((bounds?.x ?? 0) + (bounds?.width ?? 0)).toBeLessThanOrEqual(800);
});

test("startup storage failure provides an actionable retry surface", async ({ page }) => {
  await page.addInitScript(() => {
    IDBFactory.prototype.open = () => {
      throw new Error("Fixture storage unavailable");
    };
  });
  await page.goto("/");
  const alert = page.getByRole("alert");
  await expect(alert).toContainText("Local data could not be initialized");
  await expect(alert).toContainText("Fixture storage unavailable");
  await expect(alert.getByRole("button", { name: "Retry" })).toBeVisible();
  await expect(page.locator("main.workspace")).toBeVisible();
});

test("interrupted Desktop run can be dismissed without replaying tools", async ({
  page,
}, testInfo) => {
  test.skip(!isDesktop(testInfo), "Desktop recovery UI only");
  await configurePage(page);
  await seedFixture(page, { withConversation: true });
  await page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("evir");
      request.onerror = () => reject(request.error ?? new Error("Unable to open Evir test DB"));
      request.onsuccess = () => resolve(request.result);
    });
    const transaction = database.transaction("settings", "readwrite");
    transaction.objectStore("settings").put({
      name: "checkpoint:fixture-conversation",
      value: {
        id: "checkpoint-fixture",
        conversationId: "fixture-conversation",
        createdAt: Date.parse("2026-08-06T12:02:00+08:00"),
        messageCount: 0,
        tokenEstimate: 0,
        summary: "Interrupted fixture",
        objective: "Verify recovery",
        completedSteps: [],
        pendingSteps: ["verify"],
        unresolvedErrors: [],
      },
    });
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () =>
        reject(transaction.error ?? new Error("Unable to seed checkpoint"));
    });
    database.close();
  });
  await page.reload();

  const recovery = page.getByRole("status");
  await expect(recovery).toContainText("An interrupted task was found");
  await expect(recovery).toContainText("will not replay tools automatically");
  await recovery.getByRole("button", { name: "Dismiss" }).click();
  await expect(recovery).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("status")).toHaveCount(0);
});

test("Desktop workspace selection state can be cleared safely and stays cleared", async ({
  page,
}, testInfo) => {
  test.skip(!isDesktop(testInfo), "Desktop workspace UI only");
  await configurePage(page);
  await page.evaluate(() => {
    localStorage.setItem("evir-workspace", JSON.stringify(["/tmp/evir-fixture"]));
    localStorage.setItem("evir-workspace-current", "/tmp/evir-fixture");
  });
  await seedFixture(page);
  const workspace = page.locator(".workspace-selector");
  await expect(workspace).toContainText("tmp/evir-fixture");
  await workspace.getByRole("button", { name: "Clear workspace" }).click();
  const confirmation = page.getByRole("alertdialog", { name: "Clear this data?" });
  await expect(confirmation).toContainText("No files in the folder will be deleted");
  await confirmation.getByRole("button", { name: "Cancel" }).click();
  await expect(workspace).toContainText("tmp/evir-fixture");

  await workspace.getByRole("button", { name: "Clear workspace" }).click();
  await page
    .getByRole("alertdialog", { name: "Clear this data?" })
    .getByRole("button", { name: "Clear workspace" })
    .click();
  await expect(workspace.getByRole("button", { name: "Select Workspace" })).toBeVisible();
  await page.reload();
  await expect(
    page.locator(".workspace-selector").getByRole("button", { name: "Select Workspace" }),
  ).toBeVisible();
});

test("persisted Agent completion evidence returns after reloading a conversation", async ({
  page,
}, testInfo) => {
  test.skip(!isDesktop(testInfo), "Desktop Agent UI only");
  await configurePage(page);
  await seedFixture(page, { messages: agentMessages("complete") });
  await page.evaluate(async () => {
    localStorage.setItem("evir-workspace", JSON.stringify(["/tmp/evir-fixture"]));
    localStorage.setItem("evir-workspace-current", "/tmp/evir-fixture");
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("evir");
      request.onerror = () => reject(request.error ?? new Error("Unable to open Evir test DB"));
      request.onsuccess = () => resolve(request.result);
    });
    const transaction = database.transaction(["agentRuns", "toolExecutions"], "readwrite");
    transaction.objectStore("agentRuns").put({
      id: "agent-run-fixture",
      conversationId: "fixture-conversation",
      status: "completed",
      toolCalls: [
        { id: "run-tool-1", toolName: "read_file", arguments: { path: "/tmp/evir-fixture/a.ts" } },
      ],
      toolResults: [
        {
          toolCallId: "run-tool-1",
          toolName: "read_file",
          success: true,
          output: "verified",
        },
      ],
      snapshots: [],
      fileReferences: [],
      verificationEvidence: [
        {
          type: "command_result",
          toolName: "run_command",
          success: true,
          summary: "automatic: pnpm test: passed (exit 0)",
          timestamp: Date.parse("2026-08-06T12:02:00+08:00"),
        },
      ],
      resolution: { complete: true, reason: "Verified" },
      maxIterationsReached: false,
      createdAt: Date.parse("2026-08-06T12:02:00+08:00"),
      updatedAt: Date.parse("2026-08-06T12:02:00+08:00"),
    });
    transaction.objectStore("toolExecutions").put({
      id: "agent-run-fixture:run-tool-1",
      runId: "agent-run-fixture",
      conversationId: "fixture-conversation",
      toolCall: {
        id: "run-tool-1",
        toolName: "read_file",
        arguments: { path: "/tmp/evir-fixture/a.ts" },
      },
      result: {
        toolCallId: "run-tool-1",
        toolName: "read_file",
        success: true,
        output: "verified",
      },
      createdAt: Date.parse("2026-08-06T12:02:00+08:00"),
    });
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () =>
        reject(transaction.error ?? new Error("Unable to seed Agent run"));
    });
    database.close();
  });
  await page.reload();
  await page.locator(".conversation-item", { hasText: "Quality verification" }).click();
  await expect(page.getByRole("heading", { name: "Agent Run Summary" })).toBeVisible();
  await expect(page.getByText("Execution evidence", { exact: true })).toBeVisible();
  const assistantContent = await page.locator(".message-assistant .message-main").boundingBox();
  const evidenceCard = await page.locator(".agent-run-summary").boundingBox();
  expect(assistantContent).not.toBeNull();
  expect(evidenceCard).not.toBeNull();
  expect(Math.abs((evidenceCard?.x ?? 0) - (assistantContent?.x ?? 0))).toBeLessThanOrEqual(1);
  expect(evidenceCard?.width ?? 821).toBeLessThanOrEqual(820);
  expect(evidenceCard?.width ?? 0).toBeLessThan(assistantContent?.width ?? 0);

  const row = page.locator(".conversation-item", { hasText: "Quality verification" });
  await row.hover();
  await row.getByRole("button", { name: "Delete" }).click();
  await page
    .getByRole("alertdialog", { name: "Delete this item?" })
    .getByRole("button", { name: "Delete", exact: true })
    .click();
  await expect(row).toHaveCount(0);
  expect(
    await page.evaluate(async () => {
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open("evir");
        request.onerror = () => reject(request.error ?? new Error("Unable to open Evir test DB"));
        request.onsuccess = () => resolve(request.result);
      });
      const transaction = database.transaction(["agentRuns", "toolExecutions"], "readonly");
      const count = (store: string) =>
        new Promise<number>((resolve, reject) => {
          const request = transaction.objectStore(store).count();
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error ?? new Error(`Unable to count ${store}`));
        });
      const counts = await Promise.all([count("agentRuns"), count("toolExecutions")]);
      database.close();
      return counts;
    }),
  ).toEqual([0, 0]);
});
