import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  envPrefix: ["VITE_", "TAURI_"],
  define: {
    "import.meta.env.VITE_EVIR_TARGET": JSON.stringify(mode === "desktop" ? "desktop" : "web"),
  },
  server: {
    port: 1420,
    strictPort: true,
  },
}));
