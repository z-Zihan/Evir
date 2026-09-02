const SENSITIVE_KEY_PATTERN =
  /(authorization|api[-_]?key|token|password|secret|cookie|private[-_]?key)/i;
// Numeric counters/timings whose names merely contain "token" must survive redaction.
const SAFE_KEYS = new Set([
  "inputtokens",
  "outputtokens",
  "totaltokens",
  "maxcontexttokens",
  "estimatedinputtokens",
  "reservedoutputtokens",
  "reservedtooltokens",
  "firsttokenms",
  "lasttokenms",
  "tokenspersecond",
]);

function isSensitiveKey(key: string): boolean {
  return !SAFE_KEYS.has(key.toLowerCase()) && SENSITIVE_KEY_PATTERN.test(key);
}

const SECRET_VALUE_PATTERNS: RegExp[] = [
  /\bsk-[A-Za-z0-9_-]{12,}\b/g,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}\b/gi,
];

const URL_LIKE_KEY_PATTERN = /^(?:url|target|href|location)$/i;

export function redactUrlForLog(value: string): string {
  try {
    const url = new URL(value);
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return value.split(/[?#]/, 1)[0] ?? "";
  }
}

export function redactLogValue(value: unknown, seen: WeakSet<object> = new WeakSet()): unknown {
  if (typeof value === "string") {
    return SECRET_VALUE_PATTERNS.reduce(
      (current, pattern) => current.replace(pattern, "[REDACTED]"),
      value,
    );
  }

  if (Array.isArray(value)) {
    if (seen.has(value)) return "[CIRCULAR]";
    seen.add(value);
    return value.map((entryValue) => redactLogValue(entryValue, seen));
  }

  if (value !== null && typeof value === "object") {
    if (seen.has(value)) return "[CIRCULAR]";
    seen.add(value);
    return Object.fromEntries(
      Object.entries(value).map(([key, entryValue]) => {
        if (isSensitiveKey(key)) return [key, "[REDACTED]"];
        if (URL_LIKE_KEY_PATTERN.test(key) && typeof entryValue === "string") {
          return [key, redactUrlForLog(entryValue)];
        }
        return [key, redactLogValue(entryValue, seen)];
      }),
    );
  }

  return value;
}
