import { defineConfig, devices } from "@playwright/test";

const chrome = {
  ...devices["Desktop Chrome"],
  channel: "chrome" as const,
};

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : 1,
  timeout: 30_000,
  expect: { timeout: 7_000, toHaveScreenshot: { maxDiffPixelRatio: 0.01 } },
  outputDir: "artifacts/playwright/results",
  snapshotPathTemplate: "{testDir}/snapshots/{projectName}/{arg}{ext}",
  reporter: [["list"], ["html", { outputFolder: "artifacts/playwright/report", open: "never" }]],
  use: {
    ...chrome,
    locale: "en-US",
    timezoneId: "Asia/Shanghai",
    colorScheme: "light",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
  },
  projects: [
    { name: "web-e2e", use: { baseURL: "http://127.0.0.1:1420" } },
    { name: "desktop-e2e", use: { baseURL: "http://127.0.0.1:1421" } },
    { name: "web-ui", use: { baseURL: "http://127.0.0.1:1420" } },
    { name: "desktop-ui", use: { baseURL: "http://127.0.0.1:1421" } },
    { name: "web-visual", use: { baseURL: "http://127.0.0.1:1420" } },
    { name: "desktop-visual", use: { baseURL: "http://127.0.0.1:1421" } },
    { name: "web-a11y", use: { baseURL: "http://127.0.0.1:1420" } },
    { name: "desktop-a11y", use: { baseURL: "http://127.0.0.1:1421" } },
  ],
  webServer: [
    {
      command: "pnpm exec vite --mode web --host 127.0.0.1 --port 1420",
      url: "http://127.0.0.1:1420",
      reuseExistingServer: !process.env.CI,
    },
    {
      command: "pnpm exec vite --mode desktop --host 127.0.0.1 --port 1421",
      url: "http://127.0.0.1:1421",
      reuseExistingServer: !process.env.CI,
    },
    {
      command: "node e2e/fixtures/provider-server.mjs",
      url: "http://127.0.0.1:1430/health",
      reuseExistingServer: !process.env.CI,
    },
  ],
});
