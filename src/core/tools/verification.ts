import type { EvirRuntime } from "../../runtime/types";

export interface VerificationResult {
  command: string;
  exitCode: number | null;
  status: "passed" | "failed" | "cancelled" | "timed_out" | "skipped";
  durationMs: number;
  stdoutPreview: string;
  stderrPreview: string;
}

interface ProjectType {
  checker: string;
  program: string;
  args: string[];
}

function detectProjectType(files: string[]): ProjectType | null {
  if (files.includes("package.json")) {
    return { checker: "pnpm check", program: "pnpm", args: ["check"] };
  }
  if (files.includes("Cargo.toml")) {
    return { checker: "cargo test", program: "cargo", args: ["test"] };
  }
  if (files.includes("pyproject.toml") || files.includes("pytest.ini")) {
    return { checker: "pytest", program: "pytest", args: [] };
  }
  if (files.includes("go.mod")) {
    return { checker: "go test", program: "go", args: ["test", "./..."] };
  }
  if (files.includes("Makefile")) {
    return { checker: "make check", program: "make", args: ["check"] };
  }
  return null;
}

export async function runVerification(
  workspacePath: string,
  runtime: EvirRuntime,
): Promise<VerificationResult> {
  if (runtime.target !== "desktop" || !runtime.storage) {
    return {
      command: "skipped (web mode)",
      exitCode: null,
      status: "skipped",
      durationMs: 0,
      stdoutPreview: "",
      stderrPreview: "Verification not available in browser mode",
    };
  }

  // List workspace root to detect project type
  try {
    const entries = await runtime.storage.listDir(workspacePath);
    const fileNames = entries.map((e) => e.name);
    const project = detectProjectType(fileNames);
    if (!project) {
      return {
        command: "skipped (no project config found)",
        exitCode: null,
        status: "skipped",
        durationMs: 0,
        stdoutPreview: "",
        stderrPreview: `No recognized project config in ${workspacePath}`,
      };
    }

    const start = Date.now();
    const result = await runtime.storage.runCommand(
      workspacePath,
      project.program,
      project.args,
      60_000,
    );
    const durationMs = Date.now() - start;

    return {
      command: project.checker,
      exitCode: result.exit_code,
      status: result.success ? "passed" : "failed",
      durationMs,
      stdoutPreview: result.stdout.slice(0, 2000),
      stderrPreview: result.stderr.slice(0, 2000),
    };
  } catch (error) {
    return {
      command: "error",
      exitCode: null,
      status: "failed",
      durationMs: 0,
      stdoutPreview: "",
      stderrPreview: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function getGitDiff(workspacePath: string, runtime: EvirRuntime): Promise<string> {
  if (runtime.target !== "desktop" || !runtime.storage) {
    return "Git diff not available in browser mode";
  }
  try {
    return await runtime.storage.gitDiff(workspacePath, false);
  } catch {
    return "Failed to get git diff";
  }
}

export async function getGitStatus(
  workspacePath: string,
  runtime: EvirRuntime,
): Promise<{
  isRepo: boolean;
  entries: Array<{ status: string; file: string }>;
  branch: string | null;
}> {
  if (runtime.target !== "desktop" || !runtime.storage) {
    return { isRepo: false, entries: [], branch: null };
  }
  try {
    const result = await runtime.storage.gitStatus(workspacePath);
    return { isRepo: result.is_repo, entries: result.entries, branch: result.branch };
  } catch {
    return { isRepo: false, entries: [], branch: null };
  }
}
