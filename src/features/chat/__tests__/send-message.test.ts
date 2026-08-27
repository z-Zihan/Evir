import { describe, expect, it } from "vitest";
import { parseDoneWhen } from "../send-message";

describe("parseDoneWhen", () => {
  it("collects lines after a standalone marker", () => {
    const text = "Create the file.\nDone when:\n- ls hello.txt exits 0\n- cat hello.txt prints ok";
    expect(parseDoneWhen(text)).toEqual(["ls hello.txt exits 0", "cat hello.txt prints ok"]);
  });

  it("supports the marker inline on the same line", () => {
    const text = "在项目根目录创建 hello.txt，内容为一行 ok。Done when: ls hello.txt PASS";
    expect(parseDoneWhen(text)).toEqual(["ls hello.txt PASS"]);
  });

  it("splits inline conditions on semicolons", () => {
    const text = "Fix the build. Done when: cargo test passes; cargo clippy is clean";
    expect(parseDoneWhen(text)).toEqual(["cargo test passes", "cargo clippy is clean"]);
  });

  it("supports the Chinese inline marker with a full-width colon", () => {
    const text = "修复构建。完成条件：cargo test 通过";
    expect(parseDoneWhen(text)).toEqual(["cargo test 通过"]);
  });

  it("keeps the standalone-marker form working when the marker lacks a colon", () => {
    const text = "Do the task.\nDone when\nls hello.txt";
    expect(parseDoneWhen(text)).toEqual(["ls hello.txt"]);
  });

  it("returns empty when no marker exists", () => {
    expect(parseDoneWhen("只是普通一句话")).toEqual([]);
  });

  it("caps the number of collected conditions", () => {
    const lines = Array.from({ length: 14 }, (_, index) => `- condition ${index + 1}`);
    const text = ["Done when:", ...lines].join("\n");
    expect(parseDoneWhen(text)).toHaveLength(10);
  });
});
