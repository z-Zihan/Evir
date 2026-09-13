// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { BROWSER_TOOLS, isLoopbackUrl } from "../builtin/browser-tools";
import { validateToolForExecution } from "../tool-executor";
import type { EvirRuntime } from "../../../runtime/types";

/**
 * BRW-2 navigation policy: loopback targets stay L1 (the project's own
 * preview), everything else resolves to L3 and enters the approval
 * conversation — in every profile, per-call in Ask; the workspace profile
 * can grant "allow this tool in this project" scoped relief.
 */

function runtimeWith(profile: "ask" | "workspace"): EvirRuntime {
  return {
    target: "desktop",
    capabilities: new Set(["browserAutomation"]),
    has: (capability: string) => capability === "browserAutomation",
    mode: "agent",
    permissionContext:
      profile === "workspace"
        ? { profile: "workspace", roots: ["/proj"] }
        : { profile: "ask", roots: ["/proj"] },
  } as unknown as EvirRuntime;
}

describe("isLoopbackUrl", () => {
  it("accepts loopback hosts and file URLs, rejects the open internet", () => {
    expect(isLoopbackUrl("http://localhost:5173/")).toBe(true);
    expect(isLoopbackUrl("http://127.0.0.1:3000")).toBe(true);
    expect(isLoopbackUrl("http://[::1]:8080")).toBe(true);
    expect(isLoopbackUrl("http://app.localhost/")).toBe(true);
    expect(isLoopbackUrl("file:///tmp/report.html")).toBe(true);
    expect(isLoopbackUrl("https://example.com/")).toBe(false);
    expect(isLoopbackUrl("http://192.168.1.4:5173/")).toBe(false);
    expect(isLoopbackUrl("not a url")).toBe(false);
  });
});

describe("browser navigation risk resolves per call (BRW-2)", () => {
  const open = BROWSER_TOOLS.find((tool) => tool.name === "browser_open");
  const navigate = BROWSER_TOOLS.find((tool) => tool.name === "browser_navigate");
  expect(open).toBeDefined();
  expect(navigate).toBeDefined();

  it("loopback preview navigation stays L1 — allowed in both profiles", () => {
    const args = { url: "http://localhost:5173/" };
    for (const tool of [open!, navigate!]) {
      expect(validateToolForExecution(tool, "agent", runtimeWith("ask"), false, args)).toBeNull();
      expect(
        validateToolForExecution(tool, "agent", runtimeWith("workspace"), false, args),
      ).toBeNull();
    }
  });

  it("external navigation resolves to L3 — permission required in both profiles", () => {
    const args = { url: "https://example.com/docs" };
    for (const tool of [open!, navigate!]) {
      expect(
        validateToolForExecution(tool, "agent", runtimeWith("ask"), false, args),
      ).toBe("permission_required");
      expect(
        validateToolForExecution(tool, "agent", runtimeWith("workspace"), false, args),
      ).toBe("permission_required");
    }
  });

  it("an approved retry never re-gates, even for external URLs", () => {
    const args = { url: "https://example.com/docs" };
    expect(validateToolForExecution(open!, "agent", runtimeWith("ask"), true, args)).toBeNull();
  });

  it("browser_fill is L3: password-class inputs always need the approval conversation", () => {
    const fill = BROWSER_TOOLS.find((tool) => tool.name === "browser_fill");
    expect(fill).toBeDefined();
    expect(fill?.riskLevel).toBe("L3");
    expect(
      validateToolForExecution(fill!, "agent", runtimeWith("workspace"), false, {
        element_ref: "e1",
        value: "hunter2",
      }),
    ).toBe("permission_required");
  });

  it("the browser capability gate still hides every tool without browserAutomation", () => {
    const runtime = {
      target: "web" as const,
      capabilities: new Set<string>(),
      has: () => false,
      mode: "agent" as const,
    } as unknown as EvirRuntime;
    expect(
      validateToolForExecution(open!, "agent", runtime, false, { url: "http://localhost:5173/" }),
    ).toBe("capability_not_available");
  });
});
