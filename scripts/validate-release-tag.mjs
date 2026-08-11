import { readFile } from "node:fs/promises";

const tag = process.argv[2];
const stableTag = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

if (!tag || !stableTag.test(tag)) {
  process.stderr.write(
    "Invalid release tag. Expected stable SemVer v<MAJOR>.<MINOR>.<PATCH>, for example v0.2.0.\n",
  );
  process.exitCode = 1;
} else {
  const version = tag.slice(1);
  const manifests = ["package.json", "extensions/vscode/package.json", "packages/cli/package.json"];
  const mismatches = [];

  for (const manifest of manifests) {
    const parsed = JSON.parse(await readFile(new URL(`../${manifest}`, import.meta.url), "utf8"));
    if (parsed.version !== version) mismatches.push(`${manifest}: ${parsed.version ?? "missing"}`);
  }

  if (mismatches.length > 0) {
    process.stderr.write(
      `Tag ${tag} does not match every package version (${version} required):\n${mismatches.join("\n")}\n`,
    );
    process.exitCode = 1;
  } else {
    process.stdout.write(`Validated Evir release tag ${tag}.\n`);
  }
}
