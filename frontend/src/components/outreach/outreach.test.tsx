import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { JobCard, Outreach, Recommendations } from "@/lib/api/schemas";

const recommendations = vi.fn();
const outreachByJob = vi.fn();
const outreachList = vi.fn();
const editOutreach = vi.fn();
const approveOutreach = vi.fn();
const deleteOutreach = vi.fn();
const startRun = vi.fn();
vi.mock("@/lib/api/endpoints", () => ({
  api: {
    recommendations: () => recommendations(),
    outreachByJob: (id: string) => outreachByJob(id),
    outreachList: () => outreachList(),
    editOutreach: (id: number, b: unknown) => editOutreach(id, b),
    approveOutreach: (id: number) => approveOutreach(id),
    deleteOutreach: (id: number) => deleteOutreach(id),
    startRun: (b: unknown) => startRun(b),
    outreachFeedback: vi.fn(),
  },
}));
vi.mock("@/lib/api/sse", () => ({ useRunEvents: () => ({ events: [], status: "idle", finished: null }) }));

import { ApiError } from "@/lib/api/client";
import { DraftsList } from "./drafts-list";
import { OutreachPage } from "./outreach-page";
import { JobDetail } from "@/components/jobs/job-detail";

const job: JobCard = {
  job_id: "s1", title: "Platform Engineer", company: "Lumen Labs", location: "Remote (EU)", remote: true, score: 86,
  rationale: "You have shipped FastAPI services.", strengths: ["FastAPI"], gaps: ["No Go"], apply_url: "https://boards.example.com/lumen/1", pasted: false,
};
const RECS: Recommendations = { startup: [job], mid: [], mnc: [] };

const draft = (o: Partial<Outreach> = {}): Outreach => ({
  id: 7, job_id: "s1", job_title: "Platform Engineer", company: "Lumen Labs", channel: "email", subject: "FastAPI work", body: "Hi,\n\nI built FastAPI services.\n\nPriya",
  recipient_email: "", status: "critic_passed",
  critic: { scores: { grounding: 94, tone: 88 }, overall: 90, unsupported_claims: [], violations: [], verdict: "pass", rewrite_instructions: "" },
  warnings: [], attempts: 2,
  facts_used: [
    { id: "F-J1", text: "Role: Platform Engineer at Lumen Labs", source: "job", source_ref: "https://boards.example.com/lumen/1" },
    { id: "F-R1", text: "Lumen raised a Series A in 2025", source: "research", source_ref: "https://news.example.com/lumen" },
    { id: "F-P1", text: "At Finlytics: Built REST endpoints", source: "profile", source_ref: null },
  ],
  approved_at: null, feedback: null, ...o,
});

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  recommendations.mockResolvedValue(RECS);
  outreachList.mockResolvedValue([{ id: 7, job_id: "s1", status: "critic_passed" }]);
  outreachByJob.mockResolvedValue(draft());
});

describe("OutreachPage", () => {
  it("offers to write a draft when none exists, and starts the outreach run", async () => {
    outreachByJob.mockRejectedValue(new ApiError("no draft for this job yet", 404));
    startRun.mockResolvedValue({ run_id: "r1" });
    const user = userEvent.setup();
    wrap(<OutreachPage jobId="s1" />);
    await user.click(await screen.findByRole("button", { name: /write my draft/i }));
    await waitFor(() => expect(startRun).toHaveBeenCalledWith({ mode: "outreach", job_id: "s1", channel: "email", recipient_name: undefined }));
  });

  it("shows the draft, the reviewer panel and the facts it used (https sources only)", async () => {
    wrap(<OutreachPage jobId="s1" />);
    expect(await screen.findByLabelText("Subject")).toHaveValue("FastAPI work");
    expect(screen.getByText("Reviewer passed", { selector: "h2, h2 *" })).toBeInTheDocument();
    expect(screen.getByText("Lumen raised a Series A in 2025")).toBeInTheDocument();
    const sources = screen.getAllByRole("link", { name: /source/ });
    expect(sources.map((a) => a.getAttribute("href"))).toEqual(["https://boards.example.com/lumen/1", "https://news.example.com/lumen"]);
  });

  it("tracks unsaved edits and saves them", async () => {
    // A real server returns the saved draft on the refetch that follows a save.
    const saved = draft({ body: "New body", status: "draft", critic: null });
    editOutreach.mockImplementation(async () => {
      outreachByJob.mockResolvedValue(saved);
      return saved;
    });
    const user = userEvent.setup();
    wrap(<OutreachPage jobId="s1" />);
    const save = await screen.findByRole("button", { name: /save edits/i });
    expect(save).toBeDisabled();
    const body = screen.getByLabelText("Message");
    await user.clear(body);
    await user.type(body, "New body");
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
    expect(save).toBeEnabled();
    await user.click(save);
    await waitFor(() => expect(editOutreach).toHaveBeenCalledWith(7, { subject: "FastAPI work", body: "New body", recipient_email: "" }));
    await waitFor(() => expect(screen.queryByText("Unsaved changes")).not.toBeInTheDocument());
  });

  it("validates the recipient address before saving", async () => {
    const user = userEvent.setup();
    wrap(<OutreachPage jobId="s1" />);
    await user.type(await screen.findByLabelText(/Recipient email/), "nope");
    await user.click(screen.getByRole("button", { name: /save edits/i }));
    expect(screen.getByText(/valid email address/i)).toBeInTheDocument();
    expect(editOutreach).not.toHaveBeenCalled();
  });

  it("approves a reviewer-passed draft directly, then shows mail links built from the address", async () => {
    const approved = draft({ status: "user_approved", recipient_email: "talent@lumen.io", approved_at: "2026-10-20T10:00:00Z" });
    approveOutreach.mockImplementation(async () => {
      outreachByJob.mockResolvedValue(approved);
      return approved;
    });
    outreachByJob.mockResolvedValue(draft({ recipient_email: "talent@lumen.io" }));
    const user = userEvent.setup();
    wrap(<OutreachPage jobId="s1" />);
    await user.click(await screen.findByRole("button", { name: /approve as ready to send/i }));
    await waitFor(() => expect(approveOutreach).toHaveBeenCalledWith(7));
    const mail = await screen.findByRole("link", { name: /open in my email app/i });
    expect(mail.getAttribute("href")).toMatch(/^mailto:talent@lumen\.io\?subject=/);
    expect(screen.getByRole("link", { name: /gmail draft/i })).toHaveAttribute("href", expect.stringContaining("https://mail.google.com/mail/"));
  });

  it("asks for confirmation before approving a draft the reviewer has not verified", async () => {
    outreachByJob.mockResolvedValue(draft({ status: "draft", critic: null }));
    approveOutreach.mockResolvedValue(draft({ status: "user_approved" }));
    const user = userEvent.setup();
    wrap(<OutreachPage jobId="s1" />);
    await user.click(await screen.findByRole("button", { name: /approve as ready to send/i }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent(/has not verified/i);
    expect(approveOutreach).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole("button", { name: /i have read it/i }));
    await waitFor(() => expect(approveOutreach).toHaveBeenCalledWith(7));
  });

  it("never shows mail links before approval", async () => {
    wrap(<OutreachPage jobId="s1" />);
    await screen.findByLabelText("Subject");
    expect(screen.queryByRole("link", { name: /email app/i })).not.toBeInTheDocument();
  });

  it("records version history and restores an earlier version into the editor", async () => {
    localStorage.setItem(
      "nextrole_draft_versions",
      JSON.stringify({ v: 1, byJob: { s1: [{ id: "old", at: "2026-10-19T09:00:00Z", subject: "Older subject", body: "Older body", source: "edited", score: null }] } }),
    );
    const user = userEvent.setup();
    wrap(<OutreachPage jobId="s1" />);
    await screen.findByLabelText("Subject");
    // The loaded draft is recorded as the newest version; the seeded one is now second.
    await waitFor(() => expect(screen.getByText(/Latest: Written by NextRole/)).toBeInTheDocument());
    expect(JSON.parse(localStorage.getItem("nextrole_draft_versions")!).byJob.s1).toHaveLength(2);

    const older = screen.getByText("Edited by you").closest("li")!;
    await user.click(within(older).getByRole("button", { name: /compare/i }));
    expect(within(older).getAllByText(/Removed:/).length).toBeGreaterThan(0);
    await user.click(within(older).getByRole("button", { name: "Restore" }));
    expect(screen.getByLabelText("Subject")).toHaveValue("Older subject");
    expect(screen.getByLabelText("Message")).toHaveValue("Older body");
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument(); // restoring never saves by itself
    expect(editOutreach).not.toHaveBeenCalled();
  });

  it("deletes after confirmation", async () => {
    deleteOutreach.mockResolvedValue(undefined);
    const user = userEvent.setup();
    wrap(<OutreachPage jobId="s1" />);
    await user.click(await screen.findByRole("button", { name: /delete draft/i }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: /delete draft/i }));
    await waitFor(() => expect(deleteOutreach).toHaveBeenCalledWith(7));
  });

  it("explains when the job is no longer in the matches and has no draft", async () => {
    recommendations.mockResolvedValue({ startup: [], mid: [], mnc: [] });
    outreachByJob.mockRejectedValue(new ApiError("none", 404));
    wrap(<OutreachPage jobId="gone" />);
    expect(await screen.findByText(/no longer in your matches/i)).toBeInTheDocument();
  });
});

describe("JobDetail", () => {
  it("shows the match, strengths, gaps and a real apply link", async () => {
    outreachByJob.mockRejectedValue(new ApiError("none", 404));
    wrap(<JobDetail jobId="s1" />);
    expect(await screen.findByRole("heading", { level: 1, name: "Platform Engineer" })).toBeInTheDocument();
    expect(screen.getByText("You have shipped FastAPI services.")).toBeInTheDocument();
    expect(screen.getByText("FastAPI")).toBeInTheDocument();
    expect(screen.getByText("No Go")).toBeInTheDocument();
    const apply = screen.getByRole("link", { name: /apply on the company site/i });
    expect(apply).toHaveAttribute("href", "https://boards.example.com/lumen/1");
    expect(apply).toHaveAttribute("target", "_blank");
    expect(await screen.findByText(/write a draft to see company research/i)).toBeInTheDocument();
  });

  it("shows posting and research facts (not profile facts) once a draft exists", async () => {
    wrap(<JobDetail jobId="s1" />);
    expect(await screen.findByText("Lumen raised a Series A in 2025")).toBeInTheDocument();
    expect(screen.queryByText("At Finlytics: Built REST endpoints")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /open your draft/i })).toHaveAttribute("href", "/jobs/s1/outreach");
  });
});

describe("DraftsList", () => {
  it("lists drafts with job info, status counts and a filter", async () => {
    outreachList.mockResolvedValue([
      { id: 7, job_id: "s1", status: "critic_passed" },
      { id: 8, job_id: "gone", status: "user_approved" },
    ]);
    const user = userEvent.setup();
    wrap(<DraftsList />);
    expect(await screen.findByRole("link", { name: "Platform Engineer" })).toHaveAttribute("href", "/jobs/s1/outreach");
    expect(screen.getByRole("link", { name: /no longer in your matches/i })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /All \(2\)/ })).toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: /Approved \(1\)/ }));
    expect(screen.queryByRole("link", { name: "Platform Engineer" })).not.toBeInTheDocument();
  });

  it("shows an empty state with a way forward", async () => {
    outreachList.mockResolvedValue([]);
    wrap(<DraftsList />);
    expect(await screen.findByText("No drafts yet")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /go to matches/i })).toHaveAttribute("href", "/dashboard");
  });
});
