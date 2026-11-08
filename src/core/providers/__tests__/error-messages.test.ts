import { describe, expect, it } from "vitest";
import { getErrorDisplay } from "../error-messages";
import { ProviderErrorType } from "../stream-events";
import en from "../../../i18n/locales/en.json";
import zh from "../../../i18n/locales/zh-CN.json";

/**
 * Provider error i18n closure: `formatProviderError` (features/chat/chat-stream.ts)
 * renders `getErrorDisplay(type, t)` straight into the chat UI with no fallback —
 * if a ProviderErrorType is added without matching `errors.<TYPE>.title` /
 * `.description` copy, or one locale drops a key, users see the raw key string.
 * These tests pin the enum↔copy mapping in BOTH locales, in both directions.
 */

function lookup(locale: unknown, key: string): string | undefined {
  let node: unknown = locale;
  for (const part of key.split(".")) {
    if (typeof node !== "object" || node === null) return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === "string" ? node : undefined;
}

/** t() backed by a real locale fixture; a missing key resolves to "" so the
 * non-empty assertions fail naturally instead of echoing the raw key. */
function tFor(locale: unknown): (key: string) => string {
  return (key) => lookup(locale, key) ?? "";
}

const LOCALES = [
  ["en", en],
  ["zh-CN", zh],
] as const;

const TYPES = Object.values(ProviderErrorType);

describe("provider error display i18n closure", () => {
  it("every ProviderErrorType resolves to real copy in both locales", () => {
    expect(TYPES).toHaveLength(12);
    for (const type of TYPES) {
      for (const [name, locale] of LOCALES) {
        const display = getErrorDisplay(type, tFor(locale));
        for (const field of ["title", "description"] as const) {
          const value = display[field];
          expect(
            value.trim().length,
            `${name} must define errors.${type}.${field}`,
          ).toBeGreaterThan(0);
          expect(
            value,
            `${name} errors.${type}.${field} must not fall back to the raw key`,
          ).not.toBe(`errors.${type}.${field}`);
          expect(value, `${name} errors.${type}.${field} must be resolved copy`).not.toContain(
            "errors.",
          );
        }
      }
    }
  });

  it("locale errors nodes carry exactly the enum types (no missing, no orphans)", () => {
    for (const [name, locale] of LOCALES) {
      const errorsNode = (locale as unknown as { errors: Record<string, unknown> }).errors;
      // `detail` is an interpolation string, not a type entry — skip non-objects.
      const copyKeys = Object.entries(errorsNode)
        .filter(([, value]) => typeof value === "object" && value !== null)
        .map(([key]) => key)
        .sort();
      expect(copyKeys, `${name} errors node must match ProviderErrorType exactly`).toEqual(
        [...TYPES].sort(),
      );
    }
  });

  it("copy is genuinely localized (en ≠ zh-CN)", () => {
    const enTitle = getErrorDisplay(ProviderErrorType.AUTH_FAILED, tFor(en)).title;
    const zhTitle = getErrorDisplay(ProviderErrorType.AUTH_FAILED, tFor(zh)).title;
    expect(enTitle).toBe("Authentication failed");
    expect(zhTitle).toBe("认证失败");
    expect(enTitle).not.toBe(zhTitle);
  });

  it("getErrorDisplay is a pure passthrough of full i18n keys (no fallback, no truncation)", () => {
    const echo = (key: string): string => key;
    expect(getErrorDisplay(ProviderErrorType.AUTH_FAILED, echo)).toEqual({
      title: "errors.AUTH_FAILED.title",
      description: "errors.AUTH_FAILED.description",
    });
  });

  it("returns only title and description as strings", () => {
    for (const [name, locale] of LOCALES) {
      const display = getErrorDisplay(ProviderErrorType.NETWORK_ERROR, tFor(locale));
      expect(Object.keys(display).sort(), `${name} display shape`).toEqual([
        "description",
        "title",
      ]);
      expect(typeof display.title, `${name} title type`).toBe("string");
      expect(typeof display.description, `${name} description type`).toBe("string");
    }
  });
});
