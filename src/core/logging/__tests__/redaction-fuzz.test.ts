import { describe, expect, it } from "vitest";

import { RedactionMiddleware } from "../redaction-middleware";
import { Logger } from "../logger";
import type { LogEvent } from "../types";

interface FuzzCase {
  name: string;
  payload: string;
  secret: string;
}

const FUZZ_CASES: FuzzCase[] = [
  {
    name: "OpenAI-style API key",
    payload: "using key sk-abcdefghijklmnopqrstuvwx for the request",
    secret: "sk-abcdefghijklmnopqrstuvwx",
  },
  {
    name: "Bearer token in header",
    payload: "curl -H 'Authorization: Bearer abc123DEF456ghi789' https://api.example.com",
    secret: "abc123DEF456ghi789",
  },
  {
    name: "Authorization header raw",
    payload: "Authorization: Basic dXNlcjpwYXNzd29yZA==",
    secret: "dXNlcjpwYXNzd29yZA==",
  },
  {
    name: "Cookie header",
    payload: "Cookie: session_id=a1b2c3d4e5f6g7h8i9j0; path=/",
    secret: "a1b2c3d4e5f6g7h8i9j0",
  },
  {
    name: "Set-Cookie header",
    payload: "Set-Cookie: token=zzz999yyy888xxx777; HttpOnly",
    secret: "zzz999yyy888xxx777",
  },
  {
    name: "env var ANTHROPIC_API_KEY",
    payload: "ANTHROPIC_API_KEY=sk-ant-1234567890abcdef exported to shell",
    secret: "sk-ant-1234567890abcdef",
  },
  {
    name: "env var DATABASE_URL",
    payload: "DATABASE_URL=postgres://user:hunter2pass@db.internal:5432/app",
    secret: "hunter2pass",
  },
  {
    name: "env var GITHUB_TOKEN",
    payload: "GITHUB_TOKEN=ghp_abcdefghijklmnopqrstuvwxyz0123456789",
    secret: "ghp_abcdefghijklmnopqrstuvwxyz0123456789",
  },
  {
    name: "macOS home file path",
    payload: "reading config from /Users/zzihan/.ssh/id_rsa for signing",
    secret: "/Users/zzihan/.ssh/id_rsa",
  },
  {
    name: "linux home file path",
    payload: "loaded credentials at /home/deploy/.aws/credentials",
    secret: "/home/deploy/.aws/credentials",
  },
  {
    name: "full conversation body with mixed secrets",
    payload:
      "User: here's my key sk-liveKEY0000111122223333\nAssistant: Authorization: Bearer liveTokenABCDEFGH1234\nUser: also Cookie: auth=superSecretCookieValue123",
    secret: "sk-liveKEY0000111122223333",
  },
  {
    name: "Bearer token lowercase scheme",
    payload: "authorization: bearer LowerCaseTokenValue98765",
    secret: "LowerCaseTokenValue98765",
  },
  {
    name: "nested JSON-like body with token field",
    payload: '{"headers":{"Authorization":"Bearer nestedJsonToken000111"}}',
    secret: "nestedJsonToken000111",
  },
  {
    name: "stripe-style secret key",
    payload: "sk-proj-9f8e7d6c5b4a3f2e1d0c9b8a7f6e5d4c",
    secret: "sk-proj-9f8e7d6c5b4a3f2e1d0c9b8a7f6e5d4c",
  },
  {
    name: "env var with quotes",
    payload: 'export API_SECRET="topSecretQuotedValue999"',
    secret: "topSecretQuotedValue999",
  },
  {
    name: "windows-ish path mixed with home path",
    payload: "fallback path C:\\Users\\bob\\file.txt but real one is /home/bob/secrets.env",
    secret: "/home/bob/secrets.env",
  },
  {
    name: "conversation body with file path and token",
    payload: "Traceback in /Users/alice/project/src/auth.ts line 42, TOKEN=leakedRuntimeToken777",
    secret: "leakedRuntimeToken777",
  },
  {
    name: "multiple cookies in one header",
    payload: "Cookie: a=1; session=hugeSecretSessionValueXYZ; b=2",
    secret: "hugeSecretSessionValueXYZ",
  },
  {
    name: "Bearer token with dots (JWT-like)",
    payload: "Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozieDwOZgo",
    secret: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozieDwOZgo",
  },
  {
    name: "long conversation dump with multiple leak types",
    payload: [
      "=== conversation export ===",
      "System: loaded /Users/carol/.config/app/secrets.json",
      "User: my token is sk-dumpSecret000999888",
      "Assistant: Authorization: Bearer dumpBearerTokenValue123",
      "User: SESSION_SECRET=dumpEnvSecretValue456",
      "Assistant: Cookie: id=dumpCookieValue789",
    ].join("\n"),
    secret: "sk-dumpSecret000999888",
  },
];

describe("RedactionMiddleware fuzz", () => {
  const middleware = new RedactionMiddleware(new Logger());

  it.each(FUZZ_CASES)("redacts secret in case: $name", ({ payload, secret }) => {
    const output = middleware.redact(payload);
    expect(output).not.toContain(secret);
  });

  it("redacts every case with zero leaks across the full payload set", () => {
    for (const { payload, secret } of FUZZ_CASES) {
      const output = middleware.redact(payload);
      expect(output.includes(secret)).toBe(false);
    }
  });

  it("deep-redacts a LogEvent across nested string fields", () => {
    const entry: LogEvent = {
      timestamp: new Date().toISOString(),
      level: "info",
      channel: "app",
      event: "request",
      message: "Authorization: Bearer deepRedactTokenABC123",
      appVersion: "0.1.0",
      platform: "darwin",
      sessionId: "session-1",
      windowId: "window-1",
      data: {
        nested: {
          path: "/Users/dave/config/app.json",
          apiKey: "sk-nestedFieldSecret000111",
        },
      },
    };

    const redacted = middleware.redactEntry(entry);
    const serialized = JSON.stringify(redacted);

    expect(serialized).not.toContain("deepRedactTokenABC123");
    expect(serialized).not.toContain("/Users/dave/config/app.json");
    expect(serialized).not.toContain("sk-nestedFieldSecret000111");
  });

  it("supports adding custom patterns", () => {
    const custom = new RedactionMiddleware(new Logger());
    custom.addPattern(/\bCUSTOM-SECRET-[0-9]+\b/);

    const output = custom.redact("value is CUSTOM-SECRET-42 and should be gone");
    expect(output).not.toContain("CUSTOM-SECRET-42");
    expect(output).toContain("[REDACTED]");
  });

  it("custom patterns apply globally even without the g flag supplied", () => {
    const custom = new RedactionMiddleware(new Logger());
    custom.addPattern(/FOO-[0-9]+/);

    const output = custom.redact("FOO-1 and FOO-2 and FOO-3");
    expect(output).not.toMatch(/FOO-\d/);
  });

  it("performs 1000 redactions in under 50ms", () => {
    const payload = FUZZ_CASES.map((c) => c.payload).join(" | ");
    const start = performance.now();
    for (let i = 0; i < 1000; i++) {
      middleware.redact(payload);
    }
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(50);
  });
});
