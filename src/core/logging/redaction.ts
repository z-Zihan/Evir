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
      Object.entries(value).map(([key, entryValue]) => [
        key,
        isSensitiveKey(key) ? "[REDACTED]" : redactLogValue(entryValue, seen),
      ]),
    );
  }

  return value;
}
