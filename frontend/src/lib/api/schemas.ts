/**
 * API contract: Zod schemas that mirror the FastAPI/Pydantic models (see src/nextrole/models and
 * src/nextrole/api/routers). Types are derived from these, so there is ONE definition used for
 * both compile-time types and runtime validation of every response. If the backend drifts, a
 * response fails validation loudly (ApiError "unexpected response") instead of rendering garbage.
 */
import { z } from "zod";

export const TierSchema = z.enum(["startup", "mid", "mnc"]);
export type Tier = z.infer<typeof TierSchema>;

// ---- profile ----
export const ExperienceSchema = z.object({
  company: z.string(),
  title: z.string(),
  start: z.string().default(""),
  end: z.string().default(""),
  bullets: z.array(z.string()).default([]),
});
export const ProjectSchema = z.object({
  name: z.string(),
  description: z.string().default(""),
  tech: z.array(z.string()).default([]),
});
export const EducationSchema = z.object({
  institution: z.string(),
  degree: z.string().default(""),
  year: z.string().default(""),
});
export const PreferencesSchema = z.object({
  roles: z.array(z.string()).default([]),
  locations: z.array(z.string()).default([]),
  remote_ok: z.boolean().default(true),
  experience_level: z.string().default(""),
  extras: z.string().default(""),
});
export const ProfileSchema = z.object({
  name: z.string().default(""),
  summary: z.string().default(""),
  skills: z.array(z.string()).default([]),
  experience: z.array(ExperienceSchema).default([]),
  projects: z.array(ProjectSchema).default([]),
  education: z.array(EducationSchema).default([]),
  preferences: PreferencesSchema.default(() => PreferencesSchema.parse({})),
});
export type Profile = z.infer<typeof ProfileSchema>;
export type Preferences = z.infer<typeof PreferencesSchema>;

// ---- recommendations ----
export const JobCardSchema = z.object({
  job_id: z.string(),
  title: z.string(),
  company: z.string(),
  location: z.string(),
  remote: z.boolean(),
  score: z.number().int().min(0).max(100),
  rationale: z.string(),
  strengths: z.array(z.string()),
  gaps: z.array(z.string()),
  /** From the source API (https), or user-supplied for pasted jobs; null if a pasted job had none. */
  apply_url: z.string().nullable(),
  pasted: z.boolean().default(false),
});
export type JobCard = z.infer<typeof JobCardSchema>;

export const RecommendationsSchema = z.object({
  startup: z.array(JobCardSchema),
  mid: z.array(JobCardSchema),
  mnc: z.array(JobCardSchema),
});
export type Recommendations = z.infer<typeof RecommendationsSchema>;

// ---- outreach ----
export const OutreachStatusSchema = z.enum(["draft", "critic_passed", "user_approved"]);
export type OutreachStatus = z.infer<typeof OutreachStatusSchema>;

export const FactSchema = z.object({
  id: z.string(),
  text: z.string(),
  source: z.enum(["profile", "job", "research"]),
  source_ref: z.string().nullable(),
});
export type Fact = z.infer<typeof FactSchema>;

export const CriticReportSchema = z.object({
  scores: z.record(z.string(), z.number()),
  overall: z.number(),
  unsupported_claims: z.array(z.string()),
  violations: z.array(z.string()),
  verdict: z.enum(["pass", "revise"]),
  rewrite_instructions: z.string().default(""),
});
export type CriticReport = z.infer<typeof CriticReportSchema>;

export const OutreachSchema = z.object({
  id: z.number(),
  job_id: z.string(),
  job_title: z.string(),
  company: z.string(),
  channel: z.enum(["email", "message"]),
  subject: z.string(),
  body: z.string(),
  recipient_email: z.string(),
  status: OutreachStatusSchema,
  critic: CriticReportSchema.nullable(),
  warnings: z.array(z.string()),
  attempts: z.number(),
  facts_used: z.array(FactSchema),
  approved_at: z.string().nullable(),
  feedback: z.object({ rating: z.number(), note: z.string() }).nullable().default(null),
});
export type Outreach = z.infer<typeof OutreachSchema>;

export const OutreachStatusRowSchema = z.object({ id: z.number(), job_id: z.string(), status: OutreachStatusSchema });
export type OutreachStatusRow = z.infer<typeof OutreachStatusRowSchema>;

// ---- runs ----
export const RunEventSchema = z.object({
  seq: z.number(),
  ts: z.number(),
  type: z.enum(["run_started", "plan", "step_started", "step_finished", "step_failed", "run_finished"]),
  step: z.string().default(""),
  detail: z.string().default(""),
  latency_ms: z.number().default(0),
  tokens: z.number().default(0),
  cost_usd: z.number().default(0),
  data: z.record(z.string(), z.unknown()).default({}),
});
export type RunEvent = z.infer<typeof RunEventSchema>;

export const RunModeSchema = z.enum(["recommend", "outreach", "single_job"]);
export type RunMode = z.infer<typeof RunModeSchema>;

export const RunSummarySchema = z.object({
  id: z.string(),
  mode: RunModeSchema,
  status: z.enum(["running", "completed", "failed"]),
  job_id: z.string().nullable(),
  tokens: z.number(),
  cost_usd: z.number(),
  error: z.string().nullable(),
  started_at: z.string(),
  finished_at: z.string().nullable(),
});
export type RunSummary = z.infer<typeof RunSummarySchema>;

export const RunDetailSchema = RunSummarySchema.extend({
  result: z.record(z.string(), z.unknown()).default({}),
  events: z.array(RunEventSchema).default([]),
});
export type RunDetail = z.infer<typeof RunDetailSchema>;

export const StartRunResponseSchema = z.object({ run_id: z.string() });

export interface StartRunBody {
  mode: RunMode;
  job_id?: string;
  channel?: "email" | "message";
  recipient_name?: string;
  url?: string;
  text?: string;
}

// ---- auth ----
export const MeSchema = z.object({ email: z.string() });
export type Me = z.infer<typeof MeSchema>;

// ---- public (no login): real postings for the homepage hero ----
export const FeaturedJobSchema = z.object({
  title: z.string(),
  company: z.string(),
  location: z.string(),
  remote: z.boolean(),
  tier: TierSchema.nullable(),
  source: z.string(),
  /** From the source API (https), rendered verbatim; the UI refuses anything else. */
  apply_url: z.string().startsWith("https://"),
});
export type FeaturedJob = z.infer<typeof FeaturedJobSchema>;
