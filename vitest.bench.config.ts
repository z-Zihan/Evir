import { defineConfig } from "vitest/config";

// Dedicated config for the knowledge-retrieval benchmark, which the default
// vitest.config.ts excludes (it blocks the worker >60s at full scale and trips
// vitest's birpc RPC timeout, failing the run even though assertions pass).
// Run via `pnpm benchmark:knowledge`; a plain CLI --exclude override cannot
// re-include a file the config exclude drops, so the bench needs its own config.
export default defineConfig({
  test: {
    setupFiles: ["src/test/setup.ts"],
    include: ["eval/knowledge-retrieval-bench/**/*.spec.ts"],
    exclude: ["node_modules/**", "dist/**", "src-tauri/**"],
  },
});
