// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { classifyFilePreview } from "../file-preview-classify";
import { appPreviewStatus } from "../use-dev-server-ui";
import type { DevServerState } from "../../../features/workspace/dev-server-service";

function server(overrides: Partial<DevServerState>): DevServerState {
  return {
    projectId: "p1",
    cwd: "/tmp/project",
    program: "npm",
    args: ["run", "dev"],
    status: "stopped",
    port: null,
    url: null,
    pid: null,
    startedAt: 0,
    exitCode: null,
    lastOutput: [],
    ...overrides,
  };
}

describe("classifyFilePreview (§20 default strategies)", () => {
  it("routes images, pdf, opaque binaries and text by extension", () => {
    expect(classifyFilePreview("assets/hero.PNG")).toBe("image");
    expect(classifyFilePreview("photo.jpeg")).toBe("image");
    expect(classifyFilePreview("docs/report.pdf")).toBe("pdf");
    expect(classifyFilePreview("bundle.zip")).toBe("binary-meta");
    expect(classifyFilePreview("font.woff2")).toBe("binary-meta");
    expect(classifyFilePreview("data.sqlite")).toBe("binary-meta");
    expect(classifyFilePreview("README.md")).toBe("text");
    expect(classifyFilePreview("src/app.tsx")).toBe("text");
    expect(classifyFilePreview("notes.txt")).toBe("text");
    expect(classifyFilePreview("server.log")).toBe("text");
    expect(classifyFilePreview("no-extension")).toBe("text");
    expect(classifyFilePreview("C:\\repo\\build.exe".replace(/\\\\/g, "\\"))).toBe("binary-meta");
  });
});

describe("appPreviewStatus (§15 user-facing states)", () => {
  it("maps Rust lifecycle facts onto the five user states", () => {
    expect(appPreviewStatus(null, false)).toBe("idle");
    expect(appPreviewStatus(server({ status: "starting" }), false)).toBe("starting");
    expect(appPreviewStatus(null, true)).toBe("starting");
    expect(appPreviewStatus(server({ status: "ready", url: "http://localhost:5173" }), false)).toBe(
      "ready",
    );
    expect(appPreviewStatus(server({ status: "running" }), false)).toBe("ready");
    expect(appPreviewStatus(server({ status: "crashed", exitCode: 1 }), false)).toBe("error");
    expect(appPreviewStatus(server({ status: "stopped" }), false)).toBe("stopped");
    // A ready state is never downgraded by a stale poll flag.
    expect(appPreviewStatus(server({ status: "ready" }), false)).toBe("ready");
  });
});
