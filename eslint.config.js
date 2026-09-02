import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "dist",
      "**/dist",
      "artifacts",
      "**/artifacts",
      "**/.vscode-test",
      "src-tauri/target",
      "scripts",
      "extensions/vscode/scripts",
      "packages/cli/scripts",
      "e2e/fixtures",
      "vite.config.d.ts",
      "vite.config.js",
      "eslint.config.js",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
      globals: globals.browser,
    },
    plugins: { "react-hooks": reactHooks, "react-refresh": reactRefresh },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      "@typescript-eslint/no-explicit-any": "error",
    },
  },
  {
    // The primitives layer exports cva variant configs alongside components
    // (shadcn convention) and re-exports hooks — Fast Refresh boundaries don't
    // apply to a source-vendored component library.
    files: ["src/components/ui/**/*.{ts,tsx}"],
    rules: {
      "react-refresh/only-export-components": "off",
    },
  },
  {
    // MessageScroller exports its pure scroll-decision helpers
    // (shouldAttachToBottom / shouldShowJumpButton) from the same file so unit
    // tests can exercise them — jsdom has no layout, so the meaningful tests
    // are on these functions, not on scroll pixels. Editing the file falls
    // back to a full reload in dev; acceptable for one scroll primitive.
    files: ["src/app/MessageScroller.tsx"],
    rules: {
      "react-refresh/only-export-components": "off",
    },
  },
);
