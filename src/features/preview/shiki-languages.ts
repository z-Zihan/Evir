import type { LanguageInput } from "shiki";

/**
 * Curated Shiki language registry (bundle-size governance, §58): the full
 * web bundle statically references ~200 grammars, emitting all of them as
 * shipped chunks. This registry keeps the same oniguruma engine (identical
 * tokenization — visual snapshots unchanged) but only ships grammars that
 * realistically appear in Evir workspaces; anything else highlights as
 * plain text.
 */
const LANG_LOADERS: Record<string, () => Promise<{ default: LanguageInput }>> = {
  typescript: () => import("shiki/langs/typescript.mjs"),
  tsx: () => import("shiki/langs/tsx.mjs"),
  javascript: () => import("shiki/langs/javascript.mjs"),
  jsx: () => import("shiki/langs/jsx.mjs"),
  json: () => import("shiki/langs/json.mjs"),
  jsonc: () => import("shiki/langs/jsonc.mjs"),
  css: () => import("shiki/langs/css.mjs"),
  scss: () => import("shiki/langs/scss.mjs"),
  less: () => import("shiki/langs/less.mjs"),
  html: () => import("shiki/langs/html.mjs"),
  vue: () => import("shiki/langs/vue.mjs"),
  svelte: () => import("shiki/langs/svelte.mjs"),
  astro: () => import("shiki/langs/astro.mjs"),
  markdown: () => import("shiki/langs/markdown.mjs"),
  md: () => import("shiki/langs/markdown.mjs"),
  python: () => import("shiki/langs/python.mjs"),
  rust: () => import("shiki/langs/rust.mjs"),
  go: () => import("shiki/langs/go.mjs"),
  java: () => import("shiki/langs/java.mjs"),
  kotlin: () => import("shiki/langs/kotlin.mjs"),
  swift: () => import("shiki/langs/swift.mjs"),
  c: () => import("shiki/langs/c.mjs"),
  cpp: () => import("shiki/langs/cpp.mjs"),
  "c++": () => import("shiki/langs/cpp.mjs"),
  csharp: () => import("shiki/langs/csharp.mjs"),
  "c#": () => import("shiki/langs/csharp.mjs"),
  bash: () => import("shiki/langs/bash.mjs"),
  shell: () => import("shiki/langs/bash.mjs"),
  sh: () => import("shiki/langs/bash.mjs"),
  shellscript: () => import("shiki/langs/bash.mjs"),
  zsh: () => import("shiki/langs/bash.mjs"),
  powershell: () => import("shiki/langs/powershell.mjs"),
  bat: () => import("shiki/langs/bat.mjs"),
  sql: () => import("shiki/langs/sql.mjs"),
  yaml: () => import("shiki/langs/yaml.mjs"),
  toml: () => import("shiki/langs/toml.mjs"),
  ini: () => import("shiki/langs/ini.mjs"),
  dockerfile: () => import("shiki/langs/dockerfile.mjs"),
  docker: () => import("shiki/langs/dockerfile.mjs"),
  makefile: () => import("shiki/langs/makefile.mjs"),
  cmake: () => import("shiki/langs/cmake.mjs"),
  graphql: () => import("shiki/langs/graphql.mjs"),
  lua: () => import("shiki/langs/lua.mjs"),
  ruby: () => import("shiki/langs/ruby.mjs"),
  php: () => import("shiki/langs/php.mjs"),
  diff: () => import("shiki/langs/diff.mjs"),
  patch: () => import("shiki/langs/diff.mjs"),
  xml: () => import("shiki/langs/xml.mjs"),
  regex: () => import("shiki/langs/regex.mjs"),
  wasm: () => import("shiki/langs/wasm.mjs"),
  prisma: () => import("shiki/langs/prisma.mjs"),
};

/** Common short aliases people type after code fences. */
const ALIASES: Record<string, string> = {
  ts: "typescript",
  js: "javascript",
  py: "python",
  rb: "ruby",
  golang: "go",
  "c++": "cpp",
  "c#": "csharp",
  yml: "yaml",
  sh: "bash",
  zsh: "bash",
  docker: "dockerfile",
  md: "markdown",
  patch: "diff",
};

export function resolveShikiLanguage(language: string): string {
  const normalized = language.trim().toLowerCase();
  if (Object.prototype.hasOwnProperty.call(LANG_LOADERS, normalized)) return normalized;
  return ALIASES[normalized] ?? "";
}

export function loadShikiLanguage(language: string): Promise<{ default: LanguageInput }> {
  const loader = LANG_LOADERS[language];
  if (!loader) throw new Error(`unregistered shiki language: ${language}`);
  return loader();
}
