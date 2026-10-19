/**
 * API configuration. Mock mode (`NEXT_PUBLIC_API_MODE=mock`) serves realistic in-memory data so
 * every page can be built, screenshot and demoed with no backend and no LLM calls. Real mode
 * talks to the FastAPI backend through the `/api/*` rewrite (same origin, so the HttpOnly
 * session cookie works without any backend CORS change).
 */
export const IS_MOCK = process.env.NEXT_PUBLIC_API_MODE === "mock";
export const API_BASE = "/api";
export const SESSION_COOKIE = "nextrole_session";
