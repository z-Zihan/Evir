import { chromium } from "@playwright/test";
const theme = process.argv[2] ?? "light";
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
await p.addInitScript(({ theme }) => {
  localStorage.setItem("evir-language", "en");
  localStorage.setItem("evir-theme", theme);
}, { theme });
await p.goto("http://localhost:5199/", { waitUntil: "networkidle" });
await p.waitForTimeout(800);
await p.getByRole("button", { name: "Settings" }).click();
await p.waitForTimeout(900);
await p.screenshot({ path: `/tmp/ui-settings-${theme}.png` });
// provider page with form open
await p.getByRole("button", { name: /Add Provider|Connect/i }).first().click().catch(() => {});
await p.waitForTimeout(600);
await p.screenshot({ path: `/tmp/ui-settings-providers-${theme}.png` });
await b.close();
console.log("done", theme);
