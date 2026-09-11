import { describe, expect, it, vi } from "vitest";

vi.mock("../workspace-services", () => ({
  readTextFile: vi.fn(),
  statFile: vi.fn(),
}));

import { readTextFile, statFile } from "../workspace-services";
import {
  detectDevScript,
  detectDevScriptFromPackageJson,
  parseDevServerStartError,
} from "../dev-server-service";

describe("detectDevScriptFromPackageJson", () => {
  it("prefers a browser-specific dev script over an app runtime", () => {
    expect(
      detectDevScriptFromPackageJson(
        JSON.stringify({ scripts: { dev: "tauri dev", "dev:web": "vite --mode web" } }),
      ),
    ).toMatchObject({
      scriptName: "dev:web",
      command: "vite --mode web",
    });
  });

  it("falls back to the conventional dev script", () => {
    expect(
      detectDevScriptFromPackageJson(JSON.stringify({ scripts: { dev: "next dev" } })),
    ).toMatchObject({ scriptName: "dev", command: "next dev" });
  });
});

describe("detectDevScript failure split (§C2/G4)", () => {
  it("an unreadable package.json reports inspect-failed, not no-script", async () => {
    vi.mocked(readTextFile).mockRejectedValue(new Error("ipc timeout"));
    await expect(detectDevScript("/proj")).resolves.toEqual({ reason: "inspect-failed" });
  });

  it("a package.json without a matching script reports no-script", async () => {
    vi.mocked(readTextFile).mockResolvedValue(JSON.stringify({ scripts: { build: "vite build" } }));
    vi.mocked(statFile).mockRejectedValue(new Error("missing"));
    await expect(detectDevScript("/proj")).resolves.toEqual({ reason: "no-script" });
  });

  it("a valid project resolves its plan with the lockfile package manager", async () => {
    vi.mocked(readTextFile).mockResolvedValue(JSON.stringify({ scripts: { dev: "vite" } }));
    vi.mocked(statFile).mockImplementation((path: string) =>
      path.endsWith("pnpm-lock.yaml")
        ? // The service only checks whether the stat resolves; shape is unused.
          Promise.resolve({} as unknown as Awaited<ReturnType<typeof statFile>>)
        : Promise.reject(new Error("x")),
    );
    await expect(detectDevScript("/proj")).resolves.toMatchObject({
      plan: { program: "pnpm", scriptName: "dev" },
    });
  });
});

describe("parseDevServerStartError (§9/§11 structured failures)", () => {
  it("parses the structured command_not_found rejection from Rust", () => {
    expect(
      parseDevServerStartError({
        kind: "command_not_found",
        program: "pnpm",
        cwd: "/tmp/proj",
        environmentSource: "login_shell",
        message: "command not found: pnpm — not on the resolved command PATH (source: login_shell)",
      }),
    ).toEqual({
      kind: "command_not_found",
      program: "pnpm",
      environmentSource: "login_shell",
      message: "command not found: pnpm — not on the resolved command PATH (source: login_shell)",
    });
  });

  it("classifies the IPC stall timeout separately from unknown failures", () => {
    expect(
      parseDevServerStartError(
        new Error(
          "dev_server_start did not answer within 15s (known macOS custom-scheme IPC stall, tauri#7662).",
        ),
      ).kind,
    ).toBe("ipc_timeout");
    expect(parseDevServerStartError(new Error("boom")).kind).toBe("unknown");
    expect(parseDevServerStartError("plain string").kind).toBe("unknown");
  });
});
