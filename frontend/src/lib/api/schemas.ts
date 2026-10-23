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

/** Run history is internal (admins see aggregates only). Users can only ask whether a run is still going. */
export const ActiveRunSchema = z.object({ run_id: z.string().nullable(), mode: RunModeSchema.nullable() });
export type ActiveRun = z.infer<typeof ActiveRunSchema>;

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
export const MeSchema = z.object({ email: z.string(), role: z.enum(["user", "admin"]).default("user") });
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

// ---- saved jobs, watched companies, roles ----
export const SAVED_STATUSES = ["saved", "applied", "interview", "offer", "rejected"] as const;
export const SavedStatusSchema = z.enum(SAVED_STATUSES);
export type SavedStatus = z.infer<typeof SavedStatusSchema>;

export const SavedJobSchema = z.object({
  id: z.number(),
  job_id: z.string(),
  tier: TierSchema,
  status: SavedStatusSchema,
  notes: z.string(),
  saved_at: z.string(),
  status_updated_at: z.string(),
  /** false = the employer no longer lists this posting. */
  listed: z.boolean(),
  delisted_at: z.string().nullable(),
  // Snapshot taken at save time, so the entry outlives the posting.
  title: z.string(),
  company: z.string(),
  location: z.string(),
  remote: z.boolean(),
  /** From the source record (https), rendered verbatim; the UI refuses anything else. */
  apply_url: z.string().nullable(),
  summary: z.string(),
  source: z.string(),
});
export type SavedJob = z.infer<typeof SavedJobSchema>;

export const CompanySchema = z.object({ id: z.number(), name: z.string(), monitored: z.boolean() });
export type Company = z.infer<typeof CompanySchema>;

export const ResolvedRoleSchema = z.object({
  text: z.string(),
  canonical: z.string().nullable(),
  label: z.string().nullable(),
  also_matches: z.array(z.string()),
});
export type ResolvedRole = z.infer<typeof ResolvedRoleSchema>;

export const RoleTaxonomySchema = z.array(z.object({ canonical: z.string(), label: z.string(), aliases: z.array(z.string()) }));
export type RoleTaxonomy = z.infer<typeof RoleTaxonomySchema>;

export const ImportResultSchema = z.object({ imported: z.number(), skipped: z.array(z.string()) });

// ---- alerts ----
export const ALERT_FREQUENCIES = ["instant", "daily", "weekly", "off"] as const;
export const AlertSchema = z.object({
  id: z.number(),
  job_id: z.string(),
  title: z.string(),
  company: z.string(),
  location: z.string(),
  remote: z.boolean(),
  /** From the source record (https), rendered verbatim; the UI refuses anything else. */
  apply_url: z.string().nullable(),
  summary: z.string(),
  /** Which of your wanted roles it matched. */
  role: z.string(),
  /** One short line: why this matched. */
  why: z.string(),
  confidence: z.number(),
  method: z.enum(["taxonomy", "embedding", "llm"]),
  created_at: z.string(),
  read: z.boolean(),
});
export type Alert = z.infer<typeof AlertSchema>;

export const AlertSettingsSchema = z.object({
  in_app: z.boolean(),
  email: z.boolean(),
  frequency: z.enum(ALERT_FREQUENCIES),
  /** false when the server has no SMTP configured: alerts stay in the app. */
  email_available: z.boolean(),
});
export type AlertSettings = z.infer<typeof AlertSettingsSchema>;

export const AlertCheckSchema = z.object({ created: z.number(), boards: z.number(), errors: z.number() });

// ---- interview experiences ----
export const RoundSchema = z.object({ type: z.string(), difficulty: z.number(), notes: z.string() });
export const InterviewSchema = z.object({
  id: z.number(),
  company: z.string(),
  role: z.string(),
  level: z.string(),
  interviewed_on: z.string(),
  rounds: z.array(RoundSchema),
  difficulty: z.number(),
  outcome: z.string(),
  tips: z.string(),
  created_at: z.string(),
  /** First name, only when the author chose to be named. */
  author: z.string().nullable(),
  mine: z.boolean(),
  upvotes: z.number(),
  upvoted: z.boolean(),
  // Present only on the author's own posts:
  status: z.enum(["pending", "approved", "rejected", "removed"]).optional(),
  moderator_note: z.string().optional(),
});
export type Interview = z.infer<typeof InterviewSchema>;
export const InterviewPageSchema = z.object({ items: z.array(InterviewSchema), total: z.number(), page: z.number(), page_size: z.number() });
export const SubmitResultSchema = z.object({ id: z.number(), status: z.string(), message: z.string() });

export const AutoCheckSchema = z.object({
  flags: z.array(z.object({ code: z.string(), severity: z.string(), detail: z.string() })),
  llm: z.object({ pii: z.boolean(), attack: z.boolean(), confidential: z.boolean(), risk: z.string(), reasons: z.array(z.string()) }).nullable(),
  llm_status: z.string(),
  risk: z.enum(["low", "medium", "high"]),
});
export const AdminInterviewSchema = InterviewSchema.extend({
  author_id: z.number(),
  auto_check: AutoCheckSchema,
  open_reports: z.number(),
});
export type AdminInterview = z.infer<typeof AdminInterviewSchema>;
export const ReportRowSchema = z.object({
  id: z.number(), exp_id: z.number(), reason: z.string(), detail: z.string(), created_at: z.string(), company: z.string(), role: z.string(), exp_status: z.string(),
});
export type ReportRow = z.infer<typeof ReportRowSchema>;

export interface InterviewInput {
  company: string;
  role: string;
  level: string;
  interviewed_on: string;
  rounds: { type: string; difficulty: number; notes: string }[];
  difficulty: number;
  outcome: string;
  tips: string;
  anonymous: boolean;
}

// ---- admin dashboard: TOTAL aggregates only (the server never returns anything per user) ----
const TotalsSchema = z.object({
  llm_requests: z.number(), llm_errors: z.number(), error_rate: z.number(), tokens_in: z.number(), tokens_out: z.number(),
  tokens: z.number(), cost_usd: z.number(), avg_latency_ms: z.number(),
});
const BreakdownSchema = z.object({ name: z.string(), requests: z.number(), errors: z.number(), error_rate: z.number(), tokens: z.number(), cost_usd: z.number() });
export const MetricsSchema = z.object({
  range: z.object({ days: z.number(), from: z.string(), to: z.string() }),
  totals: TotalsSchema,
  previous: TotalsSchema,
  by_model: z.array(BreakdownSchema),
  by_stage: z.array(BreakdownSchema),
  series: z.array(z.object({ day: z.string(), requests: z.number(), errors: z.number(), tokens: z.number(), cost_usd: z.number() })),
  runs: z.object({
    total: z.number(), failed: z.number(), error_rate: z.number(),
    by_mode: z.array(z.object({ mode: z.string(), total: z.number(), failed: z.number(), completed: z.number() })),
  }),
  http: z.object({
    requests: z.number(), client_errors: z.number(), server_errors: z.number(), error_rate: z.number(),
    series: z.array(z.object({ day: z.string(), requests: z.number() })),
  }),
  alerts: z.object({ passes: z.number(), alerts_created: z.number(), emails_sent: z.number(), errors: z.number() }),
  interviews: z.object({ pending: z.number(), approved: z.number(), rejected: z.number(), removed: z.number(), open_reports: z.number() }),
  accounts: z.object({ total: z.number() }),
});
export type Metrics = z.infer<typeof MetricsSchema>;

export const TraceListSchema = z.array(z.object({ run_id: z.string(), modified: z.string(), size_bytes: z.number() }));
export const TraceEntriesSchema = z.array(z.object({
  run_id: z.string().nullable().optional(), ts: z.number().nullable().optional(), agent: z.string().nullable().optional(),
  inputs: z.unknown().optional(), outputs: z.unknown().optional(), latency_ms: z.number().nullable().optional(),
  input_tokens: z.number().nullable().optional(), output_tokens: z.number().nullable().optional(), cost_usd: z.number().nullable().optional(),
  error: z.string().nullable().optional(),
}));
