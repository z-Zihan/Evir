import type { EvirRuntime } from "../../runtime/types";
import { TOOL_PERMISSION_REQUIRED } from "./tool-executor";

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

    const executor = runtime.toolExecutor;
    if (!executor) {
      return {
        command: "skipped (no tool executor)",
        exitCode: null,
        status: "skipped",
        durationMs: 0,
        stdoutPreview: "",
        stderrPreview: "Automatic verification is not available in this runtime",
      };
    }

    const start = Date.now();
    // Route through the tool executor instead of raw storage so the permission
    // profile gates automatic verification like any other command — the agent
    // just wrote the very scripts this runs (e.g. package.json "scripts").
    // Verification is part of the agent run, hence the agent mode override.
    const result = await executor.execute(
      "run_command",
      { cwd: workspacePath, program: project.program, args: project.args, timeout_ms: 60_000 },
      { ...runtime, mode: "agent" as const },
    );
    const durationMs = Date.now() - start;

    if (result.error === TOOL_PERMISSION_REQUIRED) {
      // "ask" (or an unresolved profile) must not silently execute workspace
      // scripts — leave the run in needs_verification for the user instead.
      return {
        command: project.checker,
        exitCode: null,
        status: "skipped",
        durationMs,
        stdoutPreview: "",
        stderrPreview:
          "Automatic verification requires a permission profile that allows command execution (workspace or full)",
      };
    }

    return {
      command: project.checker,
      exitCode: result.success ? 0 : 1,
      status: result.success ? "passed" : "failed",
      durationMs,
      stdoutPreview: result.output.slice(0, 2000),
      stderrPreview: result.success ? "" : result.output.slice(0, 2000),
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
