import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron } from "@playwright/test";

const extensionPath = fileURLToPath(new URL("../", import.meta.url));
const executablePath = fileURLToPath(
  new URL(
    "../.vscode-test/vscode-darwin-arm64-1.132.0/Visual Studio Code.app/Contents/MacOS/Code",
    import.meta.url,
  ),
);
const workspacePath = fileURLToPath(new URL("../artifacts/visual-workspace/", import.meta.url));
const outputPath = fileURLToPath(new URL("../artifacts/qa/", import.meta.url));
const profilePath = await mkdtemp(path.join(os.tmpdir(), "evir-vscode-qa-"));
const theme = process.env.EVIR_QA_THEME === "light" ? "light" : "dark";
const suffix = theme === "light" ? "-light" : "";
const screenshotPath = (name) => path.join(outputPath, `${name}${suffix}.png`);
const userDataPath = path.join(profilePath, "user-data");

await mkdir(workspacePath, { recursive: true });
await mkdir(outputPath, { recursive: true });
await mkdir(path.join(userDataPath, "User"), { recursive: true });
await writeFile(
  path.join(userDataPath, "User", "settings.json"),
  JSON.stringify({
    "workbench.colorTheme": theme === "light" ? "Default Light Modern" : "Default Dark Modern",
  }),
);

let app;
try {
  app = await electron.launch({
    executablePath,
    args: [
      workspacePath,
      `--extensionDevelopmentPath=${extensionPath}`,
      `--user-data-dir=${userDataPath}`,
      `--extensions-dir=${path.join(profilePath, "extensions")}`,
      "--disable-updates",
      "--skip-welcome",
      "--skip-release-notes",
      "--disable-workspace-trust",
      "--no-sandbox",
    ],
  });
  let page = await app.firstWindow();
  await page.waitForTimeout(3000);
  const windows = app.windows();
  page = windows.at(-1) ?? page;
  await page.waitForLoadState("domcontentloaded");
  await page.bringToFront();
  await page.screenshot({ path: screenshotPath("vscode-initial-debug") });
  process.stdout.write(
    `VS Code windows: ${JSON.stringify(await Promise.all(windows.map((window) => window.title())))}\n`,
  );
  const evirActivity = page.locator('[aria-label="Evir"]').first();
  await evirActivity.waitFor({ state: "visible", timeout: 10_000 });
  await evirActivity.click();

  await page.screenshot({ path: screenshotPath("vscode-evir-open-debug") });
  const iframeList = page.locator("iframe.webview");
  await iframeList.first().waitFor({ state: "visible", timeout: 15_000 });
  const iframeMetadata = await iframeList.evaluateAll((elements) =>
    elements.map((element) => ({
      title: element.getAttribute("title"),
      src: element.getAttribute("src"),
    })),
  );
  process.stdout.write(`Webviews: ${JSON.stringify(iframeMetadata)}\n`);
  const evirIndex = iframeMetadata.findIndex((item) => item.title?.toLowerCase().includes("evir"));
  const iframe = iframeList.nth(evirIndex >= 0 ? evirIndex : 0);
  const frame = iframe.contentFrame();
  await frame.locator("body").waitFor({ state: "attached", timeout: 10_000 });
  process.stdout.write(
    `Evir frame: ${JSON.stringify({ url: await frame.locator("html").evaluate(() => location.href), body: (await frame.locator("body").innerHTML()).slice(0, 500) })}\n`,
  );
  const contentIframe = frame.locator("iframe").last();
  await contentIframe.waitFor({ state: "attached", timeout: 10_000 });
  const contentFrame = contentIframe.contentFrame();
  await contentFrame.locator("#provider-dialog").waitFor({ state: "visible", timeout: 10_000 });
  await iframe.screenshot({ path: screenshotPath("evir-config") });

  await contentFrame.locator("#model").fill("qa-model");
  await contentFrame.locator("#api-key").fill("qa-temporary-key");
  await contentFrame.locator("#tool-calling").check();
  await contentFrame.getByRole("button", { name: /Save|保存/ }).click();
  await contentFrame.locator("#provider-dialog").waitFor({ state: "hidden" });
  await iframe.screenshot({ path: screenshotPath("evir-empty") });

  await contentFrame.locator("#agent-mode").click();
  await contentFrame.locator("#mode-warning").waitFor({ state: "visible" });
  await iframe.screenshot({ path: screenshotPath("evir-agent-disclosure") });

  await contentFrame.locator("html").evaluate(() => {
    window.dispatchEvent(
      new MessageEvent("message", {
        data: {
          type: "approval",
          requestId: "00000000-0000-4000-8000-000000000000",
          title: "write_file",
          detail: "Replace src/example.ts (42 characters)\n\nexport const ready = true;",
          risk: "write",
        },
      }),
    );
  });
  await contentFrame.locator(".approval").waitFor({ state: "visible" });
  const approvalFocus = await contentFrame
    .locator("html")
    .evaluate(() => document.activeElement?.textContent?.trim() ?? "");
  if (!/Deny|拒绝/.test(approvalFocus)) {
    throw new Error(`Approval should focus the safe denial action first: ${approvalFocus}`);
  }
  await iframe.screenshot({ path: screenshotPath("evir-approval") });
  await contentFrame.getByRole("button", { name: /Deny|拒绝/ }).click();

  await contentFrame.locator("#prompt").focus();
  await contentFrame.locator("#prompt").press("Tab");
  const focusedId = await contentFrame
    .locator("html")
    .evaluate(() => document.activeElement?.id ?? "");
  const fit = await contentFrame.locator("html").evaluate(() => {
    const composer = document.querySelector(".composer-wrap")?.getBoundingClientRect();
    const toolbar = document.querySelector(".toolbar")?.getBoundingClientRect();
    return {
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      scrollWidth: document.documentElement.scrollWidth,
      scrollHeight: document.documentElement.scrollHeight,
      composerBottom: composer?.bottom,
      toolbarTop: toolbar?.top,
    };
  });
  if (fit.scrollWidth > fit.innerWidth || (fit.composerBottom ?? Infinity) > fit.innerHeight) {
    throw new Error(`Evir webview does not fit its viewport: ${JSON.stringify(fit)}`);
  }
  if (focusedId !== "send") throw new Error(`Unexpected keyboard focus after prompt: ${focusedId}`);

  process.stdout.write(
    `${JSON.stringify({ theme, fit, focusedId, approvalFocus, screenshots: outputPath }, null, 2)}\n`,
  );
} finally {
  if (app) await app.close().catch(() => undefined);
  await rm(profilePath, { recursive: true, force: true });
}
