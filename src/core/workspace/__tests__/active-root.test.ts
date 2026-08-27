import { describe, expect, it } from "vitest";

import { getActiveWorkspaceRoot, popRunRoot, pushRunRoot, setRootResolver } from "../active-root";

describe("active workspace root", () => {
  it("prefers a pushed run root over the live resolver", () => {
    setRootResolver(() => "/project/a");
    pushRunRoot("/project/a");

    // User switches to project B while the run is active.
    setRootResolver(() => "/project/b");
    expect(getActiveWorkspaceRoot()).toBe("/project/a");

    popRunRoot();
    expect(getActiveWorkspaceRoot()).toBe("/project/b");
  });

  it("supports nested pushes and restores the previous value", () => {
    setRootResolver(() => "/project/a");
    pushRunRoot("/project/a");
    pushRunRoot(null);

    expect(getActiveWorkspaceRoot()).toBeNull();
    popRunRoot();
    expect(getActiveWorkspaceRoot()).toBe("/project/a");
    popRunRoot();
    expect(getActiveWorkspaceRoot()).toBe("/project/a");
  });

  it("falls back to the legacy workspace when no resolver is installed", () => {
    setRootResolver(() => {
      const stored = globalThis.localStorage?.getItem("evir-workspace-current");
      return stored && stored.trim().length > 0 ? stored : null;
    });
    expect(getActiveWorkspaceRoot()).toBeNull();
  });
});
