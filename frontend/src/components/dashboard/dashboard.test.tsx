import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { JobCard, Recommendations } from "@/lib/api/schemas";

const recommendations = vi.fn();
const outreachList = vi.fn();
const runs = vi.fn();
const startRun = vi.fn();
vi.mock("@/lib/api/endpoints", () => ({
  api: { recommendations: () => recommendations(), outreachList: () => outreachList(), runs: () => runs(), startRun: (b: unknown) => startRun(b) },
}));
// The live feed is covered by run-steps tests; here it is a controllable stub.
vi.mock("@/lib/api/sse", () => ({ useRunEvents: () => ({ events: [], status: "idle", finished: null }) }));

import { ApiError } from "@/lib/api/client";
import { Dashboard } from "./dashboard";

const job = (o: Partial<JobCard>): JobCard => ({
  job_id: "j", title: "Backend Engineer", company: "Acme", location: "Berlin", remote: false, score: 70,
  rationale: "Matches your API work.", strengths: ["FastAPI"], gaps: ["No Go"], apply_url: "https://boards.example.com/acme/1", pasted: false, ...o,
});
const RECS: Recommendations = {
  startup: [job({ job_id: "s1", company: "Lumen", title: "Platform Engineer", score: 91, remote: true }), job({ job_id: "s2", company: "Pixel", title: "Data Engineer", score: 62 })],
  mid: [job({ job_id: "m1", company: "Orbit", title: "Backend Engineer", score: 77, apply_url: null })],
  mnc: [],
};

function renderDash() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={qc}><Dashboard /></QueryClientProvider>);
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  recommendations.mockResolvedValue(RECS);
  outreachList.mockResolvedValue([{ id: 1, job_id: "s1", status: "critic_passed" }]);
  runs.mockResolvedValue([]);
});

describe("Dashboard", () => {
  it("shows tier tabs with counts and the first tier's jobs, best score first", async () => {
    renderDash();
    expect(await screen.findByRole("tab", { name: /Startups \(2\)/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Mid-size \(1\)/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /MNCs \(0\)/ })).toBeInTheDocument();
    const cards = screen.getAllByRole("heading", { level: 2, name: /Engineer/ });
    expect(cards.map((c) => c.textContent)).toEqual(["Platform Engineer", "Data Engineer"]);
  });

  it("badges jobs that have a draft and links Apply to the source URL in a new tab", async () => {
    renderDash();
    await screen.findByText("Platform Engineer");
    expect(screen.getByText("Draft ready")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Open draft/ })).toHaveAttribute("href", "/jobs/s1/outreach");
    const apply = screen.getAllByRole("link", { name: /Apply/ })[0];
    expect(apply).toHaveAttribute("href", "https://boards.example.com/acme/1");
    expect(apply).toHaveAttribute("target", "_blank");
    expect(apply).toHaveAttribute("rel", expect.stringContaining("noopener"));
  });

  it("filters and offers to clear them", async () => {
    const user = userEvent.setup();
    renderDash();
    await screen.findByText("Platform Engineer");
    await user.click(screen.getByRole("button", { name: "Remote only" }));
    expect(screen.queryByText("Data Engineer")).not.toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Startups \(1\)/ })).toBeInTheDocument();
    await user.type(screen.getByRole("searchbox", { name: "Search jobs" }), "zzz");
    expect(screen.getByText("No jobs match these filters")).toBeInTheDocument();
    await user.click(screen.getAllByRole("button", { name: /Clear filters/ })[0]);
    expect(await screen.findByText("Data Engineer")).toBeInTheDocument();
  });

  it("saves a job locally and can filter to saved", async () => {
    const user = userEvent.setup();
    renderDash();
    await screen.findByText("Platform Engineer");
    await user.click(screen.getByRole("button", { name: "Save Data Engineer" }));
    expect(screen.getByRole("button", { name: "Remove Data Engineer from saved jobs" })).toHaveAttribute("aria-pressed", "true");
    await user.click(screen.getByRole("button", { name: "Saved" }));
    expect(screen.queryByText("Platform Engineer")).not.toBeInTheDocument();
    expect(screen.getByText("Data Engineer")).toBeInTheDocument();
  });

  it("starts a search run", async () => {
    startRun.mockResolvedValue({ run_id: "r1" });
    const user = userEvent.setup();
    renderDash();
    await screen.findByText("Platform Engineer");
    await user.click(screen.getByRole("button", { name: /Find new matches/ }));
    await waitFor(() => expect(startRun).toHaveBeenCalledWith({ mode: "recommend" }));
    expect(await screen.findByText("Finding your matches")).toBeInTheDocument();
  });

  it("validates the pasted job before calling the server, then starts single_job", async () => {
    startRun.mockResolvedValue({ run_id: "r2" });
    const user = userEvent.setup();
    renderDash();
    await screen.findByText("Platform Engineer");
    await user.click(screen.getByRole("button", { name: /Paste a job/ }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Score and draft" }));
    expect(within(dialog).getByText(/paste the job posting text/i)).toBeInTheDocument();
    expect(startRun).not.toHaveBeenCalled();

    await user.type(within(dialog).getByLabelText("Posting text"), "We are hiring a backend engineer to build and run our public APIs.");
    await user.click(within(dialog).getByRole("button", { name: "Score and draft" }));
    await waitFor(() => expect(startRun).toHaveBeenCalledWith({ mode: "single_job", url: undefined, text: expect.stringContaining("backend engineer") }));
  });

  it("explains a server rejection of a pasted job inside the dialog", async () => {
    startRun.mockRejectedValue(new ApiError("That page has too little readable text.", 422));
    const user = userEvent.setup();
    renderDash();
    await screen.findByText("Platform Engineer");
    await user.click(screen.getByRole("button", { name: /Paste a job/ }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText(/Link to the posting/), "https://acme.com/jobs/1");
    await user.click(within(dialog).getByRole("button", { name: "Score and draft" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(/too little readable text/);
  });

  it("shows an empty state, and an error with retry", async () => {
    recommendations.mockResolvedValueOnce({ startup: [], mid: [], mnc: [] });
    const { unmount } = renderDash();
    expect(await screen.findByText("No matches yet")).toBeInTheDocument();
    unmount();

    recommendations.mockRejectedValueOnce(new ApiError("Simulated server error", 500));
    renderDash();
    expect(await screen.findByRole("alert")).toHaveTextContent(/could not load your matches/i);
    await userEvent.setup().click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Platform Engineer")).toBeInTheDocument();
  });
});
