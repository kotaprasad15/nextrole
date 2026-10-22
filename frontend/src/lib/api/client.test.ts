import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ApiError, apiRequest, errorMessage, setUnauthorizedHandler } from "./client";

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

beforeEach(() => setUnauthorizedHandler(null));
afterEach(() => {
  vi.unstubAllGlobals();
  document.cookie = "nextrole_csrf=; path=/; max-age=0";
});

describe("errorMessage", () => {
  it("reads FastAPI string and validation-array details", () => {
    expect(errorMessage({ detail: "invalid email or password" }, 401)).toBe("invalid email or password");
    expect(errorMessage({ detail: [{ msg: "field required" }, { msg: "too short" }] }, 422)).toBe("field required; too short");
  });
  it("falls back to a status message for anything else", () => {
    expect(errorMessage(null, 500)).toBe("Request failed (500)");
    expect(errorMessage({ detail: 42 }, 400)).toBe("Request failed (400)");
  });
});

describe("apiRequest", () => {
  it("sends JSON bodies with a content type and validates the response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({ email: "a@b.co" }));
    vi.stubGlobal("fetch", fetchMock);
    const out = await apiRequest("/auth/login", { method: "POST", body: { email: "a@b.co" }, schema: z.object({ email: z.string() }) });
    expect(out).toEqual({ email: "a@b.co" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/auth/login");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ "content-type": "application/json" });
    expect(init.credentials).toBe("same-origin");
  });

  it("echoes the CSRF cookie in a header on writes, never on reads, and never invents one", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => json({}));
    vi.stubGlobal("fetch", fetchMock);
    document.cookie = "nextrole_csrf=tok%2Fen123; path=/";
    await apiRequest("/profile", { method: "PUT", body: {}, schema: z.object({}) });
    await apiRequest("/profile", { schema: z.object({}) });
    expect(fetchMock.mock.calls[0][1].headers["X-CSRF-Token"]).toBe("tok/en123");
    expect(fetchMock.mock.calls[1][1].headers?.["X-CSRF-Token"]).toBeUndefined();
    document.cookie = "nextrole_csrf=; path=/; max-age=0";
    await apiRequest("/profile", { method: "DELETE" });
    expect(fetchMock.mock.calls[2][1].headers).toBeUndefined();
  });

  it("sends FormData untouched so the browser sets the multipart boundary", async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({}));
    vi.stubGlobal("fetch", fetchMock);
    const form = new FormData();
    form.set("roles", "backend");
    await apiRequest("/onboarding", { method: "POST", body: form, schema: z.object({}) });
    const init = fetchMock.mock.calls[0][1];
    expect(init.body).toBe(form);
    expect(init.headers).toBeUndefined();
  });

  it("turns non-2xx responses into ApiError with the server's message and status", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({ detail: "email already registered" }, 409)));
    await expect(apiRequest("/auth/signup", { method: "POST", body: {} })).rejects.toMatchObject({
      name: "ApiError", status: 409, message: "email already registered", kind: "http",
    });
  });

  it("calls the unauthorized handler on 401 (and still throws)", async () => {
    const handler = vi.fn();
    setUnauthorizedHandler(handler);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({ detail: "not authenticated" }, 401)));
    await expect(apiRequest("/me")).rejects.toBeInstanceOf(ApiError);
    expect(handler).toHaveBeenCalledOnce();
  });

  it("does not call the handler for other errors", async () => {
    const handler = vi.fn();
    setUnauthorizedHandler(handler);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({ detail: "nope" }, 404)));
    await expect(apiRequest("/profile")).rejects.toMatchObject({ status: 404 });
    expect(handler).not.toHaveBeenCalled();
  });

  it("reports a friendly network error when the server is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
    await expect(apiRequest("/me")).rejects.toMatchObject({ status: 0, kind: "network" });
  });

  it("rejects a response that does not match the contract, with a safe message", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({ email: 123 })));
    const err = await apiRequest("/me", { schema: z.object({ email: z.string() }) }).catch((e) => e);
    expect(err).toMatchObject({ kind: "validation", message: "The server sent an unexpected response." });
  });

  it("lets aborts through unchanged (so callers can cancel quietly)", async () => {
    const abort = Object.assign(new Error("aborted"), { name: "AbortError" });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(abort));
    await expect(apiRequest("/me")).rejects.toMatchObject({ name: "AbortError" });
  });

  it("returns undefined for endpoints with no body (204)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
    await expect(apiRequest("/auth/logout", { method: "POST" })).resolves.toBeUndefined();
  });
});
