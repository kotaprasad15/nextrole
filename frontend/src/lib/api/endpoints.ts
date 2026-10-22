/**
 * One function per backend route. The route table lives in `routes.ts` (plain data, no imports) so
 * `scripts/check-api.mjs` can verify every route exists in the running backend's OpenAPI document.
 */
import { z } from "zod";
import { apiRequest } from "./client";
import {
  MeSchema,
  OutreachSchema,
  OutreachStatusRowSchema,
  ProfileSchema,
  RecommendationsSchema,
  RunDetailSchema,
  RunSummarySchema,
  StartRunResponseSchema,
  type Outreach,
  type Profile,
  type StartRunBody,
} from "./schemas";

export { ENDPOINTS } from "./routes";

const enc = encodeURIComponent;

export const api = {
  // auth
  signup: (email: string, password: string, confirmPassword: string) =>
    apiRequest("/auth/signup", { method: "POST", body: { email, password, confirm_password: confirmPassword }, schema: MeSchema }),
  login: (email: string, password: string) =>
    apiRequest("/auth/login", { method: "POST", body: { email, password }, schema: MeSchema }),
  logout: () => apiRequest("/auth/logout", { method: "POST" }),
  me: () => apiRequest("/me", { schema: MeSchema }),
  deleteAccount: () => apiRequest("/me", { method: "DELETE" }),

  // profile and onboarding
  profile: () => apiRequest("/profile", { schema: ProfileSchema }),
  saveProfile: (profile: Profile) => apiRequest("/profile", { method: "PUT", body: profile, schema: ProfileSchema }),
  /** Multipart: roles, locations, remote_ok, experience_level, extras, resume. Parses the resume (LLM). */
  onboard: (form: FormData) => apiRequest("/onboarding", { method: "POST", body: form, schema: ProfileSchema }),

  // recommendations
  recommendations: () => apiRequest("/recommendations", { schema: RecommendationsSchema }),

  // runs (orchestrated pipelines). Progress arrives over SSE, see sse.ts.
  startRun: (body: StartRunBody) => apiRequest("/runs", { method: "POST", body, schema: StartRunResponseSchema }),
  runs: () => apiRequest("/runs", { schema: z.array(RunSummarySchema) }),
  run: (id: string) => apiRequest(`/runs/${enc(id)}`, { schema: RunDetailSchema }),

  // outreach
  outreachList: () => apiRequest("/outreach", { schema: z.array(OutreachStatusRowSchema) }),
  outreachByJob: (jobId: string) => apiRequest(`/outreach/by-job/${enc(jobId)}`, { schema: OutreachSchema }),
  editOutreach: (id: number, body: Pick<Outreach, "subject" | "body" | "recipient_email">) =>
    apiRequest(`/outreach/${id}`, { method: "PUT", body, schema: OutreachSchema }),
  approveOutreach: (id: number) => apiRequest(`/outreach/${id}/approve`, { method: "POST", schema: OutreachSchema }),
  outreachFeedback: (id: number, rating: 1 | -1, note: string) =>
    apiRequest(`/outreach/${id}/feedback`, { method: "POST", body: { rating, note }, schema: OutreachSchema }),
  deleteOutreach: (id: number) => apiRequest(`/outreach/${id}`, { method: "DELETE" }),
};
