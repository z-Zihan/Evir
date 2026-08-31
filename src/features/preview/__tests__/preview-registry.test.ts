import { describe, expect, it } from "vitest";
import { normalizeFenceLanguage, previewRegistry } from "../preview-registry";
import type { ArtifactSource } from "../types";

function source(content: string, language = ""): ArtifactSource {
  const artifact: ArtifactSource = { content, language };
  return artifact;
}

describe("normalizeFenceLanguage", () => {
  it("maps common aliases to canonical ids", () => {
    expect(normalizeFenceLanguage("JavaScript")).toBe("js");
    expect(normalizeFenceLanguage("shell")).toBe("bash");
    expect(normalizeFenceLanguage("yml")).toBe("yaml");
    expect(normalizeFenceLanguage("python")).toBe("py");
    expect(normalizeFenceLanguage("dot")).toBe("graphviz");
    expect(normalizeFenceLanguage("jsonc")).toBe("json");
  });

  it("passes unknown languages through lowercased", () => {
    expect(normalizeFenceLanguage("KustomLang")).toBe("kustomlang");
  });
});

describe("PreviewRegistry.forLanguage", () => {
  it("resolves explicit fence languages to renderers", () => {
    expect(previewRegistry.forLanguage("html")?.id).toBe("html");
    expect(previewRegistry.forLanguage("mermaid")?.id).toBe("mermaid");
    expect(previewRegistry.forLanguage("vega-lite")?.id).toBe("vega-lite");
    expect(previewRegistry.forLanguage("csv")?.id).toBe("csv");
    expect(previewRegistry.forLanguage("diff")?.id).toBe("diff");
  });

  it("returns undefined for plain code languages", () => {
    expect(previewRegistry.forLanguage("js")).toBeUndefined();
    expect(previewRegistry.forLanguage("rust")).toBeUndefined();
  });
});

describe("PreviewRegistry.detect", () => {
  it("sniffs mermaid without a fence tag", () => {
    expect(previewRegistry.detect(source("flowchart TD\n  A --> B"))?.id).toBe("mermaid");
  });

  it("sniffs dot graphs", () => {
    expect(previewRegistry.detect(source("digraph G { a -> b }"))?.id).toBe("graphviz");
  });

  it("sniffs svg documents", () => {
    expect(
      previewRegistry.detect(source('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))?.id,
    ).toBe("svg");
  });

  it("sniffs json before yaml (priority ordering)", () => {
    expect(previewRegistry.detect(source('{"a": 1}'))?.id).toBe("json");
  });

  it("sniffs yaml mapping", () => {
    expect(previewRegistry.detect(source("name: evir\nversion: 2"))?.id).toBe("yaml");
  });

  it("sniffs html documents", () => {
    expect(previewRegistry.detect(source("<!DOCTYPE html><html><body>hi</body></html>"))?.id).toBe(
      "html",
    );
  });

  it("sniffs unified diffs", () => {
    const diff = "--- a/x\n+++ b/x\n@@ -1 +1 @@\n-old\n+new";
    expect(previewRegistry.detect(source(diff))?.id).toBe("diff");
  });

  it("sniffs vega-lite specs", () => {
    expect(previewRegistry.detect(source('{"mark": "bar", "data": {"values": []}}'))?.id).toBe(
      "vega-lite",
    );
  });

  it("returns null for ordinary code", () => {
    expect(previewRegistry.detect(source("function main() { return 1 }"))).toBeNull();
  });

  it("returns null for empty content", () => {
    expect(previewRegistry.detect(source(""))).toBeNull();
  });
});

describe("PreviewRegistry descriptors", () => {
  it("assigns trust levels per format family", () => {
    expect(previewRegistry.byId("html")?.trustLevel).toBe("UNTRUSTED_CODE");
    expect(previewRegistry.byId("svg")?.trustLevel).toBe("SAFE_MEDIA");
    expect(previewRegistry.byId("mermaid")?.trustLevel).toBe("DECLARATIVE_RENDER");
    expect(previewRegistry.byId("json")?.trustLevel).toBe("SAFE_TEXT");
    expect(previewRegistry.byId("csv")?.trustLevel).toBe("SAFE_TEXT");
  });

  it("marks only declarative renderers as streaming-capable", () => {
    expect(previewRegistry.byId("mermaid")?.supportsStreaming).toBe(true);
    expect(previewRegistry.byId("graphviz")?.supportsStreaming).toBe(true);
    expect(previewRegistry.byId("html")?.supportsStreaming).toBe(false);
    expect(previewRegistry.byId("vega")?.supportsStreaming).toBe(false);
  });

  it("resolves by extension and mime type", () => {
    expect(previewRegistry.forExtension("svg")?.id).toBe("svg");
    expect(previewRegistry.forExtension(".dot")?.id).toBe("graphviz");
    expect(previewRegistry.forMimeType("text/csv")?.id).toBe("csv");
    expect(previewRegistry.forMimeType("application/json")?.id).toBe("json");
  });

  it("keeps renderer ids unique across the registry", () => {
    const ids = previewRegistry.list().map((descriptor) => descriptor.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
