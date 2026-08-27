import { logger } from "../logging/logger";

export type NetErrorKind = "timeout" | "network" | "http" | "aborted" | "invalid-response";

export class NetError extends Error {
  readonly kind: NetErrorKind;
  readonly status: number | undefined;
  readonly path: string;

  constructor(kind: NetErrorKind, path: string, message: string, status?: number) {
    super(message);
    this.name = "NetError";
    this.kind = kind;
    this.path = path;
    this.status = status;
  }
}

export type NetMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface HttpRequest {
  path: string;
  method?: NetMethod;
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  headers?: Record<string, string>;
  timeoutMs?: number;
  signal?: AbortSignal;
  retries?: number;
}

export interface HttpResponse<T> {
  status: number;
  headers: Headers;
  data: T;
  durationMs: number;
}

export interface HttpClientOptions {
  baseUrl?: string;
  defaultTimeoutMs?: number;
  defaultRetries?: number;
  retryBaseDelayMs?: number;
  fetchImpl?: typeof fetch;
  getAuthHeaders?: () => Record<string, string>;
  /** Optional correlation metadata provider; values must be log-safe. */
  getCorrelation?: () => Record<string, string>;
}

const IDEMPOTENT_METHODS: ReadonlySet<NetMethod> = new Set(["GET"]);
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_RETRIES = 2;
const DEFAULT_RETRY_BASE_DELAY_MS = 300;

function joinUrl(baseUrl: string | undefined, path: string, query: HttpRequest["query"]): string {
  const url = new URL(path, baseUrl ?? "http://evir.local");
  if (query !== undefined) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
  }
  return baseUrl === undefined ? url.pathname + url.search : url.toString();
}

function sleep(ms: number, signal: AbortSignal | undefined): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve(), ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new NetError("aborted", "", "Aborted while waiting to retry"));
      },
      { once: true },
    );
  });
}

/**
 * Shared low-level HTTP client for future Evir backend services. It is not
 * wired to any feature yet; provider adapters keep their own streaming
 * transport. All failures surface as NetError so callers never see raw
 * fetch exceptions, and no request/response bodies are logged.
 */
export class HttpClient {
  private readonly baseUrl: string | undefined;
  private readonly defaultTimeoutMs: number;
  private readonly defaultRetries: number;
  private readonly retryBaseDelayMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly getAuthHeaders: (() => Record<string, string>) | undefined;
  private readonly getCorrelation: (() => Record<string, string>) | undefined;

  constructor(options: HttpClientOptions = {}) {
    this.baseUrl = options.baseUrl;
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.defaultRetries = options.defaultRetries ?? DEFAULT_RETRIES;
    this.retryBaseDelayMs = options.retryBaseDelayMs ?? DEFAULT_RETRY_BASE_DELAY_MS;
    this.fetchImpl = options.fetchImpl ?? ((...args) => fetch(...args));
    this.getAuthHeaders = options.getAuthHeaders;
    this.getCorrelation = options.getCorrelation;
  }

  async requestJson<T>(request: HttpRequest): Promise<HttpResponse<T>> {
    const method = request.method ?? "GET";
    const url = joinUrl(this.baseUrl, request.path, request.query);
    const retries = request.retries ?? this.defaultRetries;
    const canRetry = IDEMPOTENT_METHODS.has(method) && retries > 0;
    const requestId = crypto.randomUUID();
    const startedAt = Date.now();
    let attempt = 0;

    for (;;) {
      attempt += 1;
      const controller = new AbortController();
      const timeout = setTimeout(
        () => controller.abort(new NetError("timeout", request.path, "Request timed out")),
        request.timeoutMs ?? this.defaultTimeoutMs,
      );
      const onExternalAbort = () =>
        controller.abort(new NetError("aborted", request.path, "Aborted"));
      request.signal?.addEventListener("abort", onExternalAbort, { once: true });
      try {
        const authHeaders = this.getAuthHeaders?.() ?? {};
        const headers: Record<string, string> = {
          Accept: "application/json",
          ...authHeaders,
          ...request.headers,
        };
        if (request.body !== undefined) headers["Content-Type"] = "application/json";

        const response = await this.fetchImpl(url, {
          method,
          headers,
          ...(request.body === undefined ? {} : { body: JSON.stringify(request.body) }),
          signal: controller.signal,
        });
        const durationMs = Date.now() - startedAt;
        if (!response.ok) {
          if (canRetry && attempt <= retries && response.status >= 500) {
            await sleep(this.backoffDelayMs(attempt), request.signal);
            continue;
          }
          this.logCompleted(
            requestId,
            method,
            request.path,
            durationMs,
            attempt,
            undefined,
            response.status,
          );
          throw new NetError(
            "http",
            request.path,
            `HTTP ${response.status} ${response.statusText}`.trim(),
            response.status,
          );
        }
        const data = (await this.parseJson<T>(response, request.path)) as T;
        this.logCompleted(
          requestId,
          method,
          request.path,
          durationMs,
          attempt,
          undefined,
          response.status,
        );
        return { status: response.status, headers: response.headers, data, durationMs };
      } catch (error) {
        const durationMs = Date.now() - startedAt;
        const mapped = this.mapTransportError(error, request.path);
        const retriable = mapped.kind === "network" || mapped.kind === "timeout";
        if (canRetry && attempt <= retries && retriable) {
          await sleep(this.backoffDelayMs(attempt), request.signal);
          continue;
        }
        this.logCompleted(
          requestId,
          method,
          request.path,
          durationMs,
          attempt,
          mapped.kind,
          mapped.status,
        );
        throw mapped;
      } finally {
        clearTimeout(timeout);
        request.signal?.removeEventListener("abort", onExternalAbort);
      }
    }
  }

  private async parseJson<T>(response: Response, path: string): Promise<T> {
    const raw = await response.text();
    if (raw.length === 0) return undefined as T;
    try {
      return JSON.parse(raw) as T;
    } catch {
      throw new NetError("invalid-response", path, "Response was not valid JSON");
    }
  }

  private mapTransportError(error: unknown, path: string): NetError {
    if (error instanceof NetError) return error;
    if (error instanceof DOMException && error.name === "AbortError") {
      return new NetError("aborted", path, "Request aborted");
    }
    if (error instanceof TypeError) {
      return new NetError("network", path, "Network request failed");
    }
    return new NetError(
      "network",
      path,
      error instanceof Error ? error.name : "Network request failed",
    );
  }

  private backoffDelayMs(attempt: number): number {
    const base = this.retryBaseDelayMs * 2 ** (attempt - 1);
    const jitter = Math.random() * this.retryBaseDelayMs;
    return Math.min(base + jitter, 8_000);
  }

  private logCompleted(
    requestId: string,
    method: NetMethod,
    path: string,
    durationMs: number,
    attempt: number,
    errorKind: NetErrorKind | undefined,
    status?: number,
  ): void {
    logger.debug("app", errorKind === undefined ? "net.request-completed" : "net.request-failed", {
      requestId,
      method,
      path,
      status: status ?? null,
      attempt,
      durationMs,
      ...(errorKind !== undefined ? { errorType: errorKind } : {}),
      ...(this.getCorrelation?.() ?? {}),
    });
  }
}
