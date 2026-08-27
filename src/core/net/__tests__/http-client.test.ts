import { describe, expect, it, vi } from "vitest";

import { HttpClient } from "../http-client";
import { logger } from "../../logging/logger";

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

describe("HttpClient.requestJson", () => {
  it("performs a GET request and parses JSON with timing metadata", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ ok: true, value: 7 }));
    const client = new HttpClient({ baseUrl: "https://api.example.test", fetchImpl });

    const response = await client.requestJson<{ ok: boolean; value: number }>({
      path: "/v1/things",
      query: { limit: 10, cursor: undefined, active: true },
    });

    expect(response.data).toEqual({ ok: true, value: 7 });
    expect(response.status).toBe(200);
    expect(response.durationMs).toBeGreaterThanOrEqual(0);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.example.test/v1/things?limit=10&active=true");
    expect(init.method).toBe("GET");
    expect(url).not.toContain("cursor");
  });

  it("serializes JSON bodies and merges auth headers", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ id: 1 }));
    const client = new HttpClient({
      baseUrl: "https://api.example.test",
      fetchImpl,
      getAuthHeaders: () => ({ Authorization: "Bearer secret-token" }),
    });

    await client.requestJson({
      path: "/v1/things",
      method: "POST",
      body: { name: "thing" },
      headers: { "X-Trace": "trace-1" },
    });

    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe("POST");
    expect(init.body).toBe('{"name":"thing"}');
    const headers = new Headers(init.headers);
    expect(headers.get("Authorization")).toBe("Bearer secret-token");
    expect(headers.get("X-Trace")).toBe("trace-1");
    expect(headers.get("Content-Type")).toBe("application/json");
  });

  it("retries idempotent requests on 5xx and succeeds", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response("upstream error", { status: 502 }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    const client = new HttpClient({
      baseUrl: "https://api.example.test",
      fetchImpl,
      retryBaseDelayMs: 1,
    });

    const response = await client.requestJson({ path: "/v1/things", retries: 2 });

    expect(response.data).toEqual({ ok: true });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("does not retry POST failures", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("nope", { status: 500 }));
    const client = new HttpClient({
      baseUrl: "https://api.example.test",
      fetchImpl,
      retryBaseDelayMs: 1,
    });

    await expect(
      client.requestJson({ path: "/v1/things", method: "POST", body: { a: 1 } }),
    ).rejects.toMatchObject({ kind: "http", status: 500 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("maps network failures and timeouts to NetError kinds", async () => {
    const networkClient = new HttpClient({
      baseUrl: "https://api.example.test",
      fetchImpl: vi.fn().mockRejectedValue(new TypeError("fetch failed")),
      retryBaseDelayMs: 1,
    });
    await expect(
      networkClient.requestJson({ path: "/v1/things", retries: 0 }),
    ).rejects.toMatchObject({ kind: "network" });

    const timeoutClient = new HttpClient({
      baseUrl: "https://api.example.test",
      fetchImpl: vi.fn().mockImplementation(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener("abort", () => {
              const reason: unknown = init.signal?.reason;
              reject(reason instanceof Error ? reason : new DOMException("Aborted", "AbortError"));
            });
          }),
      ),
      retryBaseDelayMs: 1,
    });
    await expect(
      timeoutClient.requestJson({ path: "/v1/things", retries: 0, timeoutMs: 10 }),
    ).rejects.toMatchObject({ kind: "timeout" });
  });

  it("surfaces external aborts as aborted without retrying", async () => {
    const controller = new AbortController();
    const fetchImpl = vi.fn().mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => {
            const reason: unknown = init.signal?.reason;
            reject(reason instanceof Error ? reason : new DOMException("Aborted", "AbortError"));
          });
        }),
    );
    const client = new HttpClient({
      baseUrl: "https://api.example.test",
      fetchImpl,
      retryBaseDelayMs: 1,
    });
    const pending = client.requestJson({ path: "/v1/things", signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ kind: "aborted" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("reports invalid JSON as invalid-response", async () => {
    const client = new HttpClient({
      baseUrl: "https://api.example.test",
      fetchImpl: vi.fn().mockResolvedValue(new Response("<html>not json</html>", { status: 200 })),
    });
    await expect(client.requestJson({ path: "/v1/things" })).rejects.toMatchObject({
      kind: "invalid-response",
    });
  });

  it("logs path-level request outcomes without bodies or query strings", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    const client = new HttpClient({
      baseUrl: "https://api.example.test",
      fetchImpl,
      getCorrelation: () => ({ conversationId: "conversation-9" }),
    });
    await client.requestJson({ path: "/v1/things", query: { apiKey: "sk-live" } });

    const entry = logger
      .getEntries()
      .filter((event) => event.event === "net.request-completed")
      .pop();
    expect(entry).toMatchObject({
      channel: "app",
      conversationId: "conversation-9",
      data: { path: "/v1/things", status: 200 },
    });
    expect(JSON.stringify(entry)).not.toContain("sk-live");
    expect(JSON.stringify(entry)).not.toContain("apiKey");
  });
});
