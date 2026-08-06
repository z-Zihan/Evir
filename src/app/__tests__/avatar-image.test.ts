// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { MAX_AVATAR_SOURCE_BYTES, validateAvatarFile } from "../avatar-image";

describe("validateAvatarFile", () => {
  it("accepts supported local image formats", () => {
    expect(validateAvatarFile({ type: "image/jpeg", size: 100 })).toBeNull();
    expect(validateAvatarFile({ type: "image/png", size: 100 })).toBeNull();
    expect(validateAvatarFile({ type: "image/webp", size: 100 })).toBeNull();
  });

  it("rejects unsupported files and oversized images", () => {
    expect(validateAvatarFile({ type: "image/svg+xml", size: 100 })).toBe("type");
    expect(validateAvatarFile({ type: "image/jpeg", size: MAX_AVATAR_SOURCE_BYTES + 1 })).toBe(
      "size",
    );
  });
});
