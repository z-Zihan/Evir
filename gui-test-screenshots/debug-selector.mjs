import { chromium } from "@playwright/test";

const FIXED_NOW = Date.now();
const providers = [
  {
    id: "fixture-provider",
    name: "Local Fixture",
    protocolId: "openai-chat-completions",
    baseUrl: "http://127.0.0.1:1430/v1",
    apiKey: "fixture-key-not-secret",
    modelId: "evir-fixture-model",
    modelCapabilities: { toolCalling: true, source: "probe", verifiedAt: FIXED_NOW },
    enabled: true,
    isDefault: true,
    createdAt: FIXED_NOW,
    updatedAt: FIXED_NOW,
  },
  {
    id: "fixture-provider-secondary",
    name: "A second provider with a deliberately long display name",
    protocolId: "openai-responses",
    baseUrl: "http://127.0.0.1:1430/v1",
    apiKey: "fixture-key-not-secret",
    modelId: "a-deliberately-long-model-name-for-header-overflow-validation",
    enabled: true,
    isDefault: false,
    createdAt: FIXED_NOW,
    updatedAt: FIXED_NOW,
  },
];
const conversation = {
  id: "fixture-conversation",
  title: "A deliberately long conversation title that must truncate inside the header",
  providerId: "fixture-provider",
  modelId: "evir-fixture-model",
  createdAt: FIXED_NOW,
  updatedAt: FIXED_NOW,
};

const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 900, height: 640 } });
await p.addInitScript(
  ({ providers, conversation }) => {
    const request = indexedDB.open("evir");
    request.onupgradeneeded = () => {
      const db = request.result;
      for (const name of ["providers", "conversations", "messages"]) {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: "id" });
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction(["providers", "conversations"], "readwrite");
      for (const prov of providers) tx.objectStore("providers").put(prov);
      tx.objectStore("conversations").put(conversation);
    };
  },
  { providers, conversation },
);
await p.goto("http://localhost:1433/", { waitUntil: "networkidle" });
await p.reload({ waitUntil: "networkidle" });
await p.locator(".conversation-item").first().click();
await p.waitForTimeout(800);
await p.screenshot({ path: "/tmp/debug-900.png" });
const probe = await p.evaluate(() => {
  const header = document.querySelector(".workspace-header");
  const hb = header?.getBoundingClientRect();
  const controls = header?.querySelector(".workspace-controls")?.getBoundingClientRect();
  const switcher = document.querySelector(".model-switcher")?.getBoundingClientRect();
  const trigger = document.querySelector(".model-switcher-button")?.getBoundingClientRect();
  const hdr = document.querySelector(".workspace-header");
  const hb2 = hdr?.getBoundingClientRect();
  return {
    vw: window.innerWidth,
    headerRight: hb2 && Math.round(hb2.right),
    headerFits: hb2 ? hb2.right <= window.innerWidth && hb2.left >= 0 : null,
  };
  return {
    vw: window.innerWidth,
    header: hb && { l: Math.round(hb.left), r: Math.round(hb.right), w: Math.round(hb.width) },
    controls: controls && { l: Math.round(controls.left), r: Math.round(controls.right) },
    switcher: switcher && { l: Math.round(switcher.left), r: Math.round(switcher.right) },
    trigger: trigger && { w: Math.round(trigger.width), h: Math.round(trigger.height) },
  };
});
console.log(JSON.stringify(probe, null, 2));
await b.close();
