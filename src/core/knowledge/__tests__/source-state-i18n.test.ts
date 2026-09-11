// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import zh from "../../../i18n/locales/zh-CN.json";
import en from "../../../i18n/locales/en.json";
import { sourceDisplayState } from "../types";

/**
 * §41-§43 (Knowledge i18n closure): every reachable source-badge state must
 * resolve to real copy in BOTH locales — the badge used to render raw keys
 * like `knowledge.sources.state.ready` because the keys never existed. The
 * composition in KnowledgeSettings is `t(state.<serving>)` plus
 * ` · t(state.indexing.<indexing>)` when indexing is not idle; this test
 * enumerates the same space so a future state value cannot reintroduce a
 * raw key.
 */

function lookup(locale: unknown, key: string): string | undefined {
  let node: unknown = locale;
  for (const part of key.split(".")) {
    if (typeof node !== "object" || node === null) return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === "string" ? node : undefined;
}

/** Every display-state combination the badge can render. */
const COMBOS: Array<Partial<{ servingState: string; indexingState: string; status: string }>> = [
  // Two-axis records: serving × indexing.
  { servingState: "ready", indexingState: "idle" },
  { servingState: "ready", indexingState: "indexing" },
  { servingState: "ready", indexingState: "failed" },
  { servingState: "empty", indexingState: "idle" },
  { servingState: "empty", indexingState: "indexing" },
  { servingState: "empty", indexingState: "failed" },
  // Legacy single-status records map onto the same axes.
  { status: "ready" },
  { status: "indexing" },
  { status: "failed" },
  { status: "other" },
];

function keysFor(view: { serving: string; indexing: string }): string[] {
  const keys = [`knowledge.sources.state.${view.serving}`];
  if (view.indexing !== "idle") keys.push(`knowledge.sources.state.indexing.${view.indexing}`);
  return keys;
}

describe("knowledge source badge i18n (§41-§43)", () => {
  it("every reachable state has non-empty copy in zh-CN and en", () => {
    for (const combo of COMBOS) {
      const view = sourceDisplayState(combo as Parameters<typeof sourceDisplayState>[0]);
      for (const key of keysFor(view)) {
        for (const [name, locale] of [
          ["zh-CN", zh],
          ["en", en],
        ] as const) {
          const value = lookup(locale, key);
          expect(value, `${name} must define ${key}`).toBeTruthy();
          expect(value!.trim().length, `${name} ${key} must be real copy`).toBeGreaterThan(0);
        }
      }
    }
  });

  it("serving-while-failed copy does not read as a dead knowledge base (§42)", () => {
    // "Ready · Last update failed" — the serving axis leads so users see the
    // index is still searchable; the failed axis is an update note, not the
    // whole badge.
    expect(lookup(zh, "knowledge.sources.state.ready")).toBe("就绪");
    expect(lookup(zh, "knowledge.sources.state.indexing.failed")).toContain("失败");
    expect(lookup(en, "knowledge.sources.state.ready")).toBe("Ready");
    expect(lookup(en, "knowledge.sources.state.indexing.failed")).toBe("Last update failed");
  });
});
