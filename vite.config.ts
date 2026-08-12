import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

function bundledSkillNotices(): Plugin {
  const assets = [
    {
      fileName: "third-party-notices/skills/THIRD_PARTY_NOTICES.md",
      sourcePath: "./skills/builtin/THIRD_PARTY_NOTICES.md",
    },
    {
      fileName: "third-party-notices/skills/APACHE-2.0.txt",
      sourcePath: "./skills/builtin/frontend-design/LICENSE.txt",
    },
  ];

  return {
    name: "bundle-skill-notices",
    generateBundle() {
      for (const asset of assets) {
        this.emitFile({
          type: "asset",
          fileName: asset.fileName,
          source: readFileSync(fileURLToPath(new URL(asset.sourcePath, import.meta.url)), "utf8"),
        });
      }
    },
  };
}

export default defineConfig(({ mode }) => {
  const target = mode === "desktop" ? "desktop" : "web";

  return {
    plugins: [react(), tailwindcss(), bundledSkillNotices()],
    clearScreen: false,
    envPrefix: ["VITE_", "TAURI_"],
    define: {
      "import.meta.env.VITE_EVIR_TARGET": JSON.stringify(target),
    },
    build: {
      outDir: `dist/${target}`,
    },
    server: {
      port: 1420,
      strictPort: true,
    },
  };
});
