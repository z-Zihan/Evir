import path from "node:path";
import { describe, expect, it } from "vitest";
import { pathIsInside } from "../src/workspace-boundary";

describe("workspace path boundary", () => {
  it("accepts the root and descendants but rejects traversal and prefix siblings", () => {
    const root = path.resolve("/tmp/evir-project");
    expect(pathIsInside(root, root)).toBe(true);
    expect(pathIsInside(root, path.join(root, "src", "index.ts"))).toBe(true);
    expect(pathIsInside(root, path.resolve(root, "../outside.txt"))).toBe(false);
    expect(pathIsInside(root, path.resolve("/tmp/evir-project-copy/file.ts"))).toBe(false);
  });
});
