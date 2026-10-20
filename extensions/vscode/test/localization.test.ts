import { describe, expect, it } from "vitest";
import { strings } from "../src/localization";

/**
 * English is the default catalog; Chinese is only selected on explicit request
 * (the editor display language is not a signal).
 */
describe("VS Code localization", () => {
  it("returns the English catalog by default", () => {
    expect(strings().configure).toBe("Configure provider");
    expect(strings("en").configure).toBe("Configure provider");
  });

  it("returns the Chinese catalog only when explicitly requested", () => {
    expect(strings("zh").configure).toBe("配置模型服务");
  });

  it("keeps both catalogs on the same key set", () => {
    expect(Object.keys(strings("zh")).sort()).toEqual(Object.keys(strings("en")).sort());
  });
});
