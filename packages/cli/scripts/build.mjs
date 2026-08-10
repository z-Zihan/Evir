import { chmod, mkdir } from "node:fs/promises";
import { build } from "esbuild";

const output = new URL("../dist/cli.js", import.meta.url);
await mkdir(new URL("../dist/", import.meta.url), { recursive: true });
await mkdir(new URL("../artifacts/", import.meta.url), { recursive: true });

await build({
  entryPoints: [new URL("../src/cli.ts", import.meta.url).pathname],
  outfile: output.pathname,
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node20",
  external: ["@napi-rs/keyring"],
  banner: { js: "#!/usr/bin/env node" },
  minify: true,
  sourcemap: false,
  logLevel: "info",
});

await chmod(output, 0o755);
