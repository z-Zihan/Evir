import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    setupFiles: ["src/test/setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}", "eval/**/*.spec.ts"],
    exclude: ["e2e/**", "node_modules/**", "dist/**", "src-tauri/**"],
  },
});
