import { readFile } from "node:fs/promises";

const workflowUrl = new URL("../.github/workflows/release.yml", import.meta.url);
const workflow = await readFile(workflowUrl, "utf8");

const requiredFragments = [
  "arch: arm64",
  "target: aarch64-apple-darwin",
  "build_args: --target aarch64-apple-darwin",
  "src-tauri/target/aarch64-apple-darwin/release/bundle/dmg/*.dmg",
  "arch: x64",
  "target: x86_64-apple-darwin",
  "build_args: --target x86_64-apple-darwin",
  "src-tauri/target/x86_64-apple-darwin/release/bundle/dmg/*.dmg",
  "name: evir-${{ matrix.os }}-${{ matrix.arch }}",
  "if-no-files-found: error",
];

const missing = requiredFragments.filter((fragment) => !workflow.includes(fragment));
const macosRows = workflow.match(/^\s+os: macos$/gm) ?? [];

if (macosRows.length !== 2) {
  process.stderr.write(
    `Release workflow must contain exactly two explicit macOS build rows; found ${macosRows.length}.\n`,
  );
  process.exitCode = 1;
} else if (missing.length > 0) {
  process.stderr.write(
    `Release workflow is missing required dual-architecture settings:\n${missing.join("\n")}\n`,
  );
  process.exitCode = 1;
} else {
  process.stdout.write("Validated macOS Apple Silicon and Intel release targets.\n");
}
