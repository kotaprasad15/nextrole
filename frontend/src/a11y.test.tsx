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

import { ALL_JOBS, PAST_RUNS, PROFILE, RECOMMENDATIONS, draftFor } from "@/lib/api/mock/data";
import { ApiError } from "@/lib/api/client";
import { RunDetailSchema, RunSummarySchema } from "@/lib/api/schemas";

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
    runs: async () => PAST_RUNS.map((r) => ({ ...r, events: undefined, result: undefined })),
    run: async (id: string) => PAST_RUNS.find((r) => r.id === id),
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
  },
}));
vi.mock("@/lib/api/sse", () => ({ useRunEvents: () => ({ events: [], status: "idle", finished: null }) }));

import { AuthForm } from "@/components/auth/auth-form";
import { AtsChecker } from "@/components/ats/ats-checker";
import { ActivityList } from "@/components/activity/activity-list";
import { RunDetail } from "@/components/activity/run-detail";
import { Dashboard } from "@/components/dashboard/dashboard";
import { DesignShowcase } from "@/components/design/showcase";
import { JobDetail } from "@/components/jobs/job-detail";
import { OnboardingWizard } from "@/components/onboarding/wizard";
import { DraftsList } from "@/components/outreach/drafts-list";
import { OutreachPage } from "@/components/outreach/outreach-page";
import { ProfilePage } from "@/components/profile/profile-page";
import { SettingsPage } from "@/components/settings/settings-page";
import { TooltipProvider } from "@/components/ui/tooltip";
import Home from "@/app/(marketing)/page";
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
    localStorage.setItem("nextrole_saved_jobs", JSON.stringify({ v: 1, ids: ["s1"] }));
    const user = userEvent.setup();
    const { container } = renderPage(<ProfilePage />);
    await screen.findByLabelText("Name");
    await clean(container);
    for (const name of [/Preferences/, /Saved jobs/, /Tracker/]) {
      await user.click(screen.getByRole("tab", { name }));
      await waitFor(() => expect(screen.getByRole("tab", { name })).toHaveAttribute("aria-selected", "true"));
      await screen.findByRole("tabpanel");
      await clean(container);
    }
  });

  it("activity list and a run's trace", async () => {
    const a = renderPage(<ActivityList />);
    await screen.findByText("Finished successfully");
    await clean(a.container);
    a.unmount();
    const run = RunDetailSchema.parse(PAST_RUNS[1]);
    RunSummarySchema.parse(run);
    const b = renderPage(<RunDetail runId={run.id} />);
    await screen.findByRole("heading", { level: 1, name: "Write outreach" });
    await clean(b.container);
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
    const { container } = renderPage(<Home />);
    await clean(container);
  });

  it("design system showcase", async () => {
    const { container } = renderPage(<DesignShowcase />);
    await clean(container);
  });
});
