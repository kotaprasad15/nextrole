/**
 * One function per backend route. The route table lives in `routes.ts` (plain data, no imports) so
 * `scripts/check-api.mjs` can verify every route exists in the running backend's OpenAPI document.
 */
import { z } from "zod";
import { apiRequest } from "./client";
import {
  CompanySchema,
  ImportResultSchema,
  MeSchema,
  OutreachSchema,
  OutreachStatusRowSchema,
  ProfileSchema,
  RecommendationsSchema,
  ResolvedRoleSchema,
  RoleTaxonomySchema,
  SavedJobSchema,
  type SavedStatus,
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
  /** Everything the server holds about the signed-in user (decrypted, JSON). */
  exportData: () => apiRequest("/me/export", { schema: z.record(z.string(), z.unknown()) }),

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

  // saved jobs (server-side: snapshot, status, notes)
  savedJobs: (params: { status?: SavedStatus; tier?: string; listed?: boolean; q?: string; sort?: string } = {}) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "" && v !== null) qs.set(k, String(v));
    return apiRequest(`/saved-jobs${qs.size ? `?${qs}` : ""}`, { schema: z.array(SavedJobSchema) });
  },
  saveJob: (jobId: string, status: SavedStatus = "saved") =>
    apiRequest("/saved-jobs", { method: "POST", body: { job_id: jobId, status }, schema: SavedJobSchema }),
  updateSavedJob: (id: number, body: { status?: SavedStatus; notes?: string }) =>
    apiRequest(`/saved-jobs/${id}`, { method: "PATCH", body, schema: SavedJobSchema }),
  unsaveJob: (id: number) => apiRequest(`/saved-jobs/${id}`, { method: "DELETE" }),
  importSavedJobs: (items: { job_id: string; status: SavedStatus; notes: string }[]) =>
    apiRequest("/saved-jobs/import", { method: "POST", body: { items }, schema: ImportResultSchema }),

  // watched companies and roles
  companies: () => apiRequest("/companies", { schema: z.array(CompanySchema) }),
  companySuggestions: (q: string) => apiRequest(`/companies/suggestions?q=${enc(q)}`, { schema: z.array(z.string()) }),
  addCompany: (name: string) => apiRequest("/companies", { method: "POST", body: { name }, schema: CompanySchema }),
  removeCompany: (id: number) => apiRequest(`/companies/${id}`, { method: "DELETE" }),
  roleTaxonomy: () => apiRequest("/roles/taxonomy", { schema: RoleTaxonomySchema }),
  resolveRoles: (roles: string[]) => apiRequest("/roles/resolve", { method: "POST", body: { roles }, schema: z.array(ResolvedRoleSchema) }),

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
