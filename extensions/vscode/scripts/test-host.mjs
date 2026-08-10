import { access, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { downloadAndUnzipVSCode, runTests } from "@vscode/test-electron";

const extensionDevelopmentPath = fileURLToPath(new URL("../", import.meta.url));
const extensionTestsPath = fileURLToPath(new URL("../dist/test/host/index.js", import.meta.url));
const testWorkspace = fileURLToPath(new URL("../artifacts/host-workspace/", import.meta.url));

await mkdir(testWorkspace, { recursive: true });

try {
  let vscodeExecutablePath = await downloadAndUnzipVSCode();
  if (process.platform === "darwin" && path.basename(vscodeExecutablePath) === "Electron") {
    const codeExecutable = path.join(path.dirname(vscodeExecutablePath), "Code");
    try {
      await access(codeExecutable);
      vscodeExecutablePath = codeExecutable;
    } catch {
      // Older VS Code builds still use the Electron executable name.
    }
  }
  await runTests({
    vscodeExecutablePath,
    extensionDevelopmentPath,
    extensionTestsPath,
    launchArgs: [testWorkspace, "--disable-extensions"],
  });
} catch (error) {
  console.error("VS Code extension host tests failed", error);
  process.exitCode = 1;
}
