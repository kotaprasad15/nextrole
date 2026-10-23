/**
 * Automated accessibility audit (axe-core) across every screen and its key states: forms with
 * errors, open modals, every tab. It cannot replace a keyboard/screen-reader pass, but it
 * catches the regressions that are mechanical: missing names/labels, bad ARIA, duplicate ids,
 * heading order, landmark misuse, and so on.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/dashboard",
}));

// The homepage's motion layer imports these lazily; stub them so nothing loads after teardown.
vi.mock("gsap", () => {
  const gsap = { registerPlugin: () => {}, matchMedia: () => ({ add: () => {}, revert: () => {} }), ticker: { add: () => {}, remove: () => {}, lagSmoothing: () => {} } };
  return { gsap, default: gsap };
});
vi.mock("gsap/ScrollTrigger", () => ({ ScrollTrigger: { create: () => ({}), update: () => {}, refresh: () => {} } }));
vi.mock("lenis", () => ({ default: class { on() {} raf() {} destroy() {} } }));

import { ALL_JOBS, PROFILE, RECOMMENDATIONS, SAVED_JOBS, draftFor } from "@/lib/api/mock/data";
import { ApiError } from "@/lib/api/client";

const noDraft = new Set<string>();
vi.mock("@/lib/api/endpoints", () => ({
  api: {
    me: async () => ({ email: "priya.nair@example.com" }),
    login: vi.fn(),
    signup: vi.fn(),
    logout: async () => undefined,
    deleteAccount: async () => undefined,
    profile: async () => PROFILE,
    saveProfile: async (p: unknown) => p,
    onboard: async () => PROFILE,
    recommendations: async () => RECOMMENDATIONS,
    startRun: async () => ({ run_id: "r1" }),
    activeRun: async () => ({ run_id: null, mode: null }),
    outreachList: async () => [
      { id: 1, job_id: "s1", status: "critic_passed" },
      { id: 2, job_id: "m1", status: "user_approved" },
    ],
    outreachByJob: async (jobId: string) => {
      if (noDraft.has(jobId) || !["s1", "m1"].includes(jobId)) throw new ApiError("no draft for this job yet", 404);
      return draftFor(jobId, jobId === "m1" ? "user_approved" : "critic_passed", jobId === "m1" ? 2 : 1);
    },
    editOutreach: vi.fn(),
    approveOutreach: vi.fn(),
    deleteOutreach: vi.fn(),
    outreachFeedback: vi.fn(),
    interviews: async () => ({ items: [{ id: 1, company: "Acme", role: "Software Engineer", level: "mid", interviewed_on: "2026-08", difficulty: 4, outcome: "offer",
      rounds: [{ type: "coding", difficulty: 3, notes: "Two graph problems." }], tips: "Explain your trade-offs.", created_at: "2026-09-01T09:00:00+00:00",
      author: "Sam", mine: false, upvotes: 2, upvoted: false }], total: 1, page: 1, page_size: 20 }),
    myInterviews: async () => [],
    submitInterview: vi.fn(),
    editInterview: vi.fn(),
    deleteInterview: vi.fn(),
    upvoteInterview: vi.fn(),
    reportInterview: vi.fn(),
    moderationQueue: async () => [{ id: 3, company: "Globex", role: "Backend Engineer", level: "senior", interviewed_on: "2026-07", difficulty: 5, outcome: "rejected",
      rounds: [{ type: "system_design", difficulty: 5, notes: "Distributed systems." }], tips: "Prepare.", created_at: "2026-09-02T09:00:00+00:00", author: null, mine: false,
      upvotes: 0, upvoted: false, status: "pending", moderator_note: "", author_id: 9, open_reports: 1,
      auto_check: { flags: [{ code: "attack", severity: "review", detail: "language that may be a personal attack" }], llm: null, llm_status: "unavailable", risk: "medium" } }],
    moderate: vi.fn(),
    adminMetrics: async (days: number) => {
      const t = { llm_requests: 100, llm_errors: 2, error_rate: 0.02, tokens_in: 8000, tokens_out: 2000, tokens: 10000, cost_usd: 1.5, avg_latency_ms: 900 };
      const series = [{ day: "2026-10-19", requests: 40, errors: 1, tokens: 4000, cost_usd: 0.6 }, { day: "2026-10-20", requests: 60, errors: 1, tokens: 6000, cost_usd: 0.9 }];
      return { range: { days, from: "2026-10-19", to: "2026-10-20" }, totals: t, previous: { ...t, cost_usd: 1.2 },
        by_model: [{ name: "claude-sonnet-5-5", requests: 100, errors: 2, error_rate: 0.02, tokens: 10000, cost_usd: 1.5 }],
        by_stage: [{ name: "writer", requests: 50, errors: 1, error_rate: 0.02, tokens: 5000, cost_usd: 0.75 }], series,
        runs: { total: 10, failed: 1, error_rate: 0.1, by_mode: [{ mode: "recommend", total: 10, failed: 1, completed: 9 }] },
        http: { requests: 500, client_errors: 10, server_errors: 1, error_rate: 0.002, series: series.map((s) => ({ day: s.day, requests: s.requests * 4 })) },
        alerts: { passes: 2, alerts_created: 3, emails_sent: 1, errors: 0 }, interviews: { pending: 1, approved: 2, rejected: 0, removed: 0, open_reports: 0 }, accounts: { total: 5 } };
    },
    adminTraces: async () => [{ run_id: "a1b2c3d4", modified: "2026-10-20T10:00:00+00:00", size_bytes: 2048 }],
    adminTrace: async () => [{ agent: "matcher", latency_ms: 800, input_tokens: 500, output_tokens: 100, cost_usd: 0.003, error: null }],
    moderationReports: async () => [],
    dismissReport: vi.fn(),
    alerts: async () => [
      { id: 1, job_id: "j1", title: "Software Development Engineer II", company: "Stripe", location: "Remote", remote: true, apply_url: "https://boards.example.com/stripe/1",
        summary: "", role: "SDE", why: "Same kind of job as SDE.", confidence: 0.95, method: "taxonomy", created_at: "2026-10-20T08:00:00+00:00", read: false },
    ],
    alertsSummary: async () => ({ unread: 1 }),
    alertSettings: async () => ({ in_app: true, email: true, frequency: "daily", email_available: true }),
    saveAlertSettings: vi.fn(),
    readAlert: vi.fn(),
    readAllAlerts: vi.fn(),
    dismissAlert: vi.fn(),
    checkAlerts: vi.fn(),
    unsubscribeAlerts: vi.fn(),
    savedJobs: async () => SAVED_JOBS,
    saveJob: vi.fn(),
    updateSavedJob: vi.fn(),
    unsaveJob: vi.fn(),
    importSavedJobs: vi.fn(),
    companies: async () => [{ id: 1, name: "Stripe", monitored: true }, { id: 2, name: "Tiny Co", monitored: false }],
    companySuggestions: async () => ["Airbnb", "Figma"],
    addCompany: vi.fn(),
    removeCompany: vi.fn(),
    resolveRoles: async (roles: string[]) => roles.map((text) => ({ text, canonical: null, label: null, also_matches: [] })),
  },
}));
vi.mock("@/lib/api/sse", () => ({ useRunEvents: () => ({ events: [], status: "idle", finished: null }) }));

import { AuthForm } from "@/components/auth/auth-form";
import { AtsChecker } from "@/components/ats/ats-checker";
import { Dashboard } from "@/components/dashboard/dashboard";
import { DesignShowcase } from "@/components/design/showcase";
import { JobDetail } from "@/components/jobs/job-detail";
import { OnboardingWizard } from "@/components/onboarding/wizard";
import { DraftsList } from "@/components/outreach/drafts-list";
import { OutreachPage } from "@/components/outreach/outreach-page";
import { ProfilePage } from "@/components/profile/profile-page";
import { SettingsPage } from "@/components/settings/settings-page";
import { SavedPage } from "@/components/saved/saved-page";
import { AlertsPage } from "@/components/alerts/alerts-page";
import { AdminPage } from "@/components/admin/admin-page";
import { ModerationPage } from "@/components/admin/moderation-page";
import { ExperienceForm } from "@/components/interviews/experience-form";
import { InterviewsPage } from "@/components/interviews/interviews-page";
import { Unsubscribe } from "@/components/alerts/unsubscribe";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Hero } from "@/components/marketing/hero";
import { HomeBody } from "@/components/marketing/home-body";
import { SAMPLE_JD, SAMPLE_RESUME } from "@/lib/ats/sample";
import { a11yViolations } from "@/test/axe";

const renderPage = (ui: React.ReactElement) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={qc}><TooltipProvider>{ui}</TooltipProvider></QueryClientProvider>);
};
const clean = async (container: Element) => expect(await a11yViolations(container.ownerDocument.body)).toEqual([]);

beforeEach(() => {
  localStorage.clear();
  noDraft.clear();
  document.body.innerHTML = "";
});

describe("accessibility (axe)", () => {
  it("login and signup forms, including validation errors", async () => {
    const user = userEvent.setup();
    const a = renderPage(<AuthForm mode="login" />);
    await clean(a.container);
    await user.click(screen.getByRole("button", { name: "Log in" }));
    expect(await screen.findByText(/enter your email/i)).toBeInTheDocument();
    await clean(a.container);
    a.unmount();
    const b = renderPage(<AuthForm mode="signup" />);
    await user.type(screen.getByLabelText("Password"), "abc");
    await clean(b.container);
  });

  it("onboarding steps", async () => {
    const user = userEvent.setup();
    const { container } = renderPage(<OnboardingWizard />);
    await clean(container);
    await user.click(screen.getByRole("button", { name: /continue/i }));
    await clean(container); // step 1 with an error
    await user.type(screen.getByLabelText("Roles"), "SWE{Enter}");
    await user.click(screen.getByRole("button", { name: /continue/i }));
    await screen.findByRole("heading", { name: /where, and at what level/i });
    await clean(container);
    await user.click(await screen.findByRole("radio", { name: /Mid-level/ }));
    await user.type(screen.getByLabelText("Locations"), "Leeds{Enter}");
    await user.click(screen.getByRole("button", { name: /continue/i }));
    await screen.findByRole("heading", { name: /upload your resume/i });
    await clean(container);
  });

  it("dashboard, with the paste-a-job dialog open", async () => {
    const user = userEvent.setup();
    const { container } = renderPage(<Dashboard />);
    await screen.findByText("Software Engineer, Platform");
    await clean(container);
    await user.click(screen.getByRole("button", { name: /paste a job/i }));
    await screen.findByRole("dialog");
    await clean(container);
  });

  it("job detail, with and without a draft", async () => {
    const a = renderPage(<JobDetail jobId="s1" />);
    await screen.findByRole("heading", { level: 1, name: /Platform/ });
    await waitFor(() => expect(screen.getAllByText(/Series|facts|posting/i).length).toBeGreaterThan(0));
    await clean(a.container);
    a.unmount();
    const b = renderPage(<JobDetail jobId={ALL_JOBS[ALL_JOBS.length - 1].job_id} />);
    await screen.findByRole("heading", { level: 1 });
    await screen.findByText(/write a draft to see company research/i);
    await clean(b.container);
  });

  it("outreach: generate form, draft editor and its approve dialog", async () => {
    const a = renderPage(<OutreachPage jobId="s2" />);
    await screen.findByRole("button", { name: /write my draft/i });
    await clean(a.container);
    a.unmount();
    const user = userEvent.setup();
    const b = renderPage(<OutreachPage jobId="s1" />);
    await screen.findByLabelText("Subject");
    await clean(b.container);
    await user.type(screen.getByLabelText("Message"), " edited");
    await user.click(screen.getByRole("button", { name: /approve as ready to send/i }));
    await screen.findByRole("dialog");
    await clean(b.container);
  });

  it("drafts list", async () => {
    const { container } = renderPage(<DraftsList />);
    await screen.findByRole("radio", { name: /All \(2\)/ });
    await clean(container);
  });

  it("ATS check, before and after analysis", async () => {
    const user = userEvent.setup();
    const { container } = renderPage(<AtsChecker />);
    await clean(container);
    await user.click(screen.getByRole("button", { name: /sample data/i }));
    expect(screen.getByLabelText("Resume text")).toHaveValue(SAMPLE_RESUME);
    expect(screen.getByLabelText("Job description")).toHaveValue(SAMPLE_JD);
    await user.click(screen.getByRole("button", { name: /check my resume/i }));
    await screen.findByRole("heading", { level: 2, name: /match|needs work/i });
    await clean(container);
  });

  it("profile: every tab", async () => {
    const user = userEvent.setup();
    const { container } = renderPage(<ProfilePage />);
    await screen.findByLabelText("Name");
    await clean(container);
    for (const name of [/Preferences/]) {
      await user.click(screen.getByRole("tab", { name }));
      await waitFor(() => expect(screen.getByRole("tab", { name })).toHaveAttribute("aria-selected", "true"));
      await screen.findByRole("tabpanel");
      await clean(container);
    }
  });

  it("saved jobs page, including a posting that is no longer listed", async () => {
    localStorage.setItem("nextrole_saved_jobs", JSON.stringify({ v: 1, ids: ["old1"] })); // shows the import banner too
    const { container } = renderPage(<SavedPage />);
    await screen.findByRole("heading", { level: 2, name: "Platform Engineer" });
    expect(screen.getByText("No longer listed", { selector: "span" })).toBeInTheDocument();
    await clean(container);
  });

  it("alerts page (settings with email on, one unread alert) and the unsubscribe page", async () => {
    const a = renderPage(<AlertsPage />);
    await screen.findByRole("heading", { level: 2, name: "Software Development Engineer II" });
    await screen.findByLabelText(/how often/i);
    await clean(a.container);
    a.unmount();
    window.history.pushState({}, "", "/unsubscribe?token=1.abc");
    const b = renderPage(<Unsubscribe />);
    await clean(b.container);
  });

  it("interview experiences: browse, my posts, and the share form with an error", async () => {
    const user = userEvent.setup();
    const a = renderPage(<InterviewsPage />);
    await screen.findByRole("heading", { level: 2, name: "Acme" });
    await clean(a.container);
    await user.click(screen.getByRole("button", { name: "Report the post about Acme" }));
    await screen.findByRole("dialog");
    await clean(a.container);
    a.unmount();
    window.history.pushState({}, "", "/interviews/new");
    const b = renderPage(<ExperienceForm />);
    await screen.findByLabelText("Company");
    await user.click(screen.getByRole("button", { name: "Submit for review" }));
    await screen.findByText("Enter the company.");
    await clean(b.container);
  });

  it("admin usage dashboard with a trace open", async () => {
    const user = userEvent.setup();
    const { container } = renderPage(<AdminPage />);
    await screen.findByRole("region", { name: "Totals" });
    await clean(container);
    await user.click(await screen.findByRole("button", { name: "View trace a1b2c3d4" }));
    await screen.findByRole("rowheader", { name: "matcher" });
    await clean(container);
  });

  it("admin moderation queue", async () => {
    const { container } = renderPage(<ModerationPage />);
    await screen.findByRole("heading", { level: 2, name: "Globex" });
    await clean(container);
  });

  it("settings, with the delete dialog open", async () => {
    const user = userEvent.setup();
    const { container } = renderPage(<SettingsPage />);
    await screen.findByText("priya.nair@example.com");
    await clean(container);
    await user.click(screen.getByRole("button", { name: /delete my account and data/i }));
    await screen.findByRole("dialog");
    await clean(container);
  });

  it("homepage", async () => {
    const { container } = renderPage(<HomeBody hero={<Hero jobs={[]} />} />);
    await clean(container);
  });

  it("design system showcase", async () => {
    const { container } = renderPage(<DesignShowcase />);
    await clean(container);
  });
});
