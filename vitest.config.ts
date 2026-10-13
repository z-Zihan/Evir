import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    setupFiles: ["src/test/setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}", "eval/**/*.spec.ts"],
    // knowledge-retrieval-bench is a benchmark, not a functional test: at full
    // scale it blocks the worker >60s, tripping vitest's birpc RPC timeout
    // (onTaskUpdate) and failing the whole run even though assertions pass. Run
    // it on demand via `pnpm benchmark:knowledge` instead of the default suite.
    exclude: [
      "e2e/**",
      "node_modules/**",
      "dist/**",
      "src-tauri/**",
      "eval/knowledge-retrieval-bench/**",
    ],
  },
});
