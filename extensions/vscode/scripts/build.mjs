import { mkdir } from "node:fs/promises";
import { build } from "esbuild";

await mkdir(new URL("../dist/", import.meta.url), { recursive: true });
await mkdir(new URL("../artifacts/", import.meta.url), { recursive: true });

await build({
  entryPoints: [new URL("../src/extension.ts", import.meta.url).pathname],
  outfile: new URL("../dist/extension.js", import.meta.url).pathname,
  bundle: true,
  format: "cjs",
  platform: "node",
  target: "node20",
  external: ["vscode"],
  sourcemap: false,
  minify: true,
  logLevel: "info",
});

await build({
  entryPoints: [new URL("../test/host/index.ts", import.meta.url).pathname],
  outfile: new URL("../dist/test/host/index.js", import.meta.url).pathname,
  bundle: true,
  format: "cjs",
  platform: "node",
  target: "node20",
  external: ["vscode"],
  sourcemap: false,
  minify: false,
  logLevel: "info",
});
