const SENSITIVE_KEY_PATTERN =
  /(authorization|api[-_]?key|token|password|secret|cookie|private[-_]?key)/i;

const SECRET_VALUE_PATTERNS: RegExp[] = [
  /\bsk-[A-Za-z0-9_-]{12,}\b/g,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}\b/gi,
];

export function redactLogValue(value: unknown): unknown {
  if (typeof value === "string") {
    return SECRET_VALUE_PATTERNS.reduce(
      (current, pattern) => current.replace(pattern, "[REDACTED]"),
      value,
    );
  }

  if (Array.isArray(value)) {
    return value.map(redactLogValue);
  }

  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entryValue]) => [
        key,
        SENSITIVE_KEY_PATTERN.test(key) ? "[REDACTED]" : redactLogValue(entryValue),
      ]),
    );
  }

  return value;
}
