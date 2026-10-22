import type { ZodType } from "zod";
import { API_BASE, CSRF_COOKIE, CSRF_HEADER, IS_MOCK } from "./config";

/** Any non-2xx response, a network failure, or a response that fails schema validation. */
export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly kind: "http" | "network" | "validation" = "http",
  ) {
    super(message);
    this.name = "ApiError";
  }
}

type Unauthorized = () => void;
let onUnauthorized: Unauthorized | null = null;
/** The app shell registers a handler here (clear caches, go to /login). Kept out of fetch code. */
export function setUnauthorizedHandler(fn: Unauthorized | null) {
  onUnauthorized = fn;
}

/** FastAPI errors are `{detail: string}` or `{detail: [{msg}]}` (validation). Normalise to text. */
export function errorMessage(data: unknown, status: number): string {
  const detail = (data as { detail?: unknown } | null)?.detail;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    const msgs = detail.map((d) => (d as { msg?: string })?.msg).filter(Boolean);
    if (msgs.length) return msgs.join("; ");
  }
  return `Request failed (${status})`;
}

type Fetcher = (path: string, init?: RequestInit) => Promise<Response>;

async function realFetch(path: string, init?: RequestInit) {
  return fetch(`${API_BASE}${path}`, { credentials: "same-origin", ...init });
}

/** Resolved lazily so the mock server (and its fixtures) never ship in real mode. */
async function fetcher(): Promise<Fetcher> {
  if (IS_MOCK) return (await import("./mock")).mockFetch;
  return realFetch;
}

/** The CSRF token the backend put in a cookie (it is readable on purpose; see security/web.py). */
export function csrfToken(): string | undefined {
  if (typeof document === "undefined") return undefined;
  const hit = document.cookie.split("; ").find((c) => c.startsWith(`${CSRF_COOKIE}=`));
  return hit ? decodeURIComponent(hit.slice(CSRF_COOKIE.length + 1)) : undefined;
}

export interface RequestOptions<T> {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  /** JSON body, or FormData for multipart (never set content-type yourself for FormData). */
  body?: unknown;
  /** Validates and types the response. Omit for endpoints that return no body. */
  schema?: ZodType<T>;
  signal?: AbortSignal;
}

export async function apiRequest<T = void>(path: string, opts: RequestOptions<T> = {}): Promise<T> {
  const isForm = typeof FormData !== "undefined" && opts.body instanceof FormData;
  const method = opts.method ?? "GET";
  const headers: Record<string, string> = {};
  if (opts.body !== undefined && !isForm) headers["content-type"] = "application/json";
  const csrf = method === "GET" ? undefined : csrfToken();
  if (csrf) headers[CSRF_HEADER] = csrf; // every state-changing request proves it came from our own pages
  const init: RequestInit = {
    method,
    signal: opts.signal,
    headers: Object.keys(headers).length ? headers : undefined,
    body: opts.body === undefined ? undefined : isForm ? (opts.body as FormData) : JSON.stringify(opts.body),
  };

  let res: Response;
  try {
    res = await (await fetcher())(path, init);
  } catch (err) {
    if ((err as Error)?.name === "AbortError") throw err;
    throw new ApiError("Cannot reach the server. Check your connection and try again.", 0, "network");
  }

  const isJson = (res.headers.get("content-type") ?? "").includes("json");
  const data = isJson ? await res.json().catch(() => null) : null;

  if (!res.ok) {
    if (res.status === 401) onUnauthorized?.();
    throw new ApiError(errorMessage(data, res.status), res.status);
  }
  if (!opts.schema) return undefined as T;

  const parsed = opts.schema.safeParse(data);
  if (!parsed.success) {
    // Contract drift: surface it clearly in dev, show a safe message to users.
    if (process.env.NODE_ENV !== "production") console.error("API response failed validation", path, parsed.error.issues);
    throw new ApiError("The server sent an unexpected response.", res.status, "validation");
  }
  return parsed.data;
}
