/**
 * Opt-in contract test against a REAL running backend (read-only GETs, no LLM calls).
 *   LIVE_BASE=http://127.0.0.1:8000 LIVE_COOKIE="nextrole_session=<token>" npm test -- contract.live
 * Skipped otherwise. It parses the backend's actual JSON with the same Zod schemas the app uses,
 * so any drift between the Python models and `schemas.ts` shows up here instead of in the UI.
 */
import { describe, expect, it } from "vitest";
import {
  MeSchema, OutreachSchema, OutreachStatusRowSchema, ProfileSchema, RecommendationsSchema, ActiveRunSchema,
} from "./schemas";
import { z } from "zod";

const base = process.env.LIVE_BASE;
const cookie = process.env.LIVE_COOKIE ?? "";

async function get(path: string) {
  const res = await fetch(`${base}${path}`, { headers: { cookie } });
  return { status: res.status, body: await res.json().catch(() => null) };
}

describe.skipIf(!base)("backend contract (live)", () => {
  it("GET /me", async () => {
    const { status, body } = await get("/me");
    expect(status).toBe(200);
    MeSchema.parse(body);
  });

  it("GET /profile", async () => {
    const { status, body } = await get("/profile");
    expect(status).toBe(200);
    ProfileSchema.parse(body);
  });

  it("GET /recommendations", async () => {
    const { status, body } = await get("/recommendations");
    expect(status).toBe(200);
    RecommendationsSchema.parse(body);
  });

  it("GET /outreach", async () => {
    const { status, body } = await get("/outreach");
    expect(status).toBe(200);
    const rows = z.array(OutreachStatusRowSchema).parse(body);
    if (rows.length) {
      // The full draft payload (critic report, facts, feedback) for a real record.
      const one = await get(`/outreach/by-job/${encodeURIComponent(rows[0].job_id)}`);
      expect(one.status).toBe(200);
      OutreachSchema.parse(one.body);
    }
  });

  it("GET /runs/active", async () => {
    const res = await get("/runs/active");
    expect(res.status).toBe(200);
    ActiveRunSchema.parse(res.body);
  });

  it("error bodies use FastAPI's {detail}", async () => {
    const { status, body } = await get("/outreach/by-job/does-not-exist");
    expect(status).toBe(404);
    expect(typeof (body as { detail: string }).detail).toBe("string");
  });
});
