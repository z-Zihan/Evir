import { describe, expect, it } from "vitest";
import { customCategoryLocalizations, normalizeCustomCategory } from "../skill-categories";

describe("skill categories", () => {
  it("normalizes a readable custom category into a slug", () => {
    expect(normalizeCustomCategory("Product Marketing")).toBe("product-marketing");
    expect(customCategoryLocalizations("Product Marketing")).toEqual({
      en: "Product Marketing",
      "zh-CN": "Product Marketing",
    });
  });

  it("creates a stable slug while preserving a non-Latin label", () => {
    const first = normalizeCustomCategory("营销");
    const second = normalizeCustomCategory("营销");

    expect(first).toBe(second);
    expect(first).toMatch(/^custom-[a-z0-9]+$/);
    expect(customCategoryLocalizations("营销")).toEqual({ en: "营销", "zh-CN": "营销" });
  });

  it("does not override built-in category labels", () => {
    expect(customCategoryLocalizations("finance-investing")).toBeUndefined();
  });
});
