import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SAVED_JOBS } from "@/lib/api/mock/data";
import { SavedJobSchema } from "@/lib/api/schemas";
import { formatDate } from "@/lib/saved/status";

const savedJobs = vi.fn();
const updateSavedJob = vi.fn();
const unsaveJob = vi.fn();
const importSavedJobs = vi.fn();
const recommendations = vi.fn();
vi.mock("@/lib/api/endpoints", () => ({
  api: {
    savedJobs: (p: unknown) => savedJobs(p), updateSavedJob: (id: number, b: unknown) => updateSavedJob(id, b),
    unsaveJob: (id: number) => unsaveJob(id), importSavedJobs: (i: unknown) => importSavedJobs(i),
    recommendations: () => recommendations(),
  },
}));

import { SavedPage } from "./saved-page";

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={qc}><SavedPage /></QueryClientProvider>);
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  savedJobs.mockResolvedValue(SAVED_JOBS);
  recommendations.mockResolvedValue({
    startup: [{ job_id: "s1", title: "Platform Engineer", company: "Lumen Labs", location: "Remote", remote: true, score: 90, rationale: "", strengths: [], gaps: [], apply_url: null, pasted: false }],
    mid: [], mnc: [],
  });
  updateSavedJob.mockImplementation(async (id: number, b: object) => ({ ...SAVED_JOBS.find((s) => s.id === id)!, ...b }));
  unsaveJob.mockResolvedValue(undefined);
});

describe("Saved jobs page", () => {
  it("fixtures satisfy the API schema", () => {
    for (const s of SAVED_JOBS) SavedJobSchema.parse(s);
  });

  it("shows the snapshot, status, saved date, notes and a 'no longer listed' flag", async () => {
    renderPage();
    await screen.findByRole("heading", { level: 2, name: "Platform Engineer" });
    const [live, gone] = screen.getAllByRole("listitem");
    expect(within(live).getByText("Applied", { selector: "span" })).toBeInTheDocument();
    expect(within(live).getByText(new RegExp(`Saved ${formatDate(SAVED_JOBS[0].saved_at)}`))).toBeInTheDocument(); // locale-independent
    expect(within(live).getByLabelText("Notes for Platform Engineer at Lumen Labs")).toHaveValue("Referred by Dana.");
    expect(within(live).getByText(/Build the internal platform/)).toBeInTheDocument();
    expect(within(live).getByRole("link", { name: /Apply/ })).toHaveAttribute("href", "https://boards.example.com/lumen/1");
    expect(within(live).getByRole("link", { name: "Platform Engineer" })).toHaveAttribute("href", "/jobs/s1"); // still in matches

    expect(within(gone).getByText("No longer listed", { selector: "span" })).toBeInTheDocument();
    expect(within(gone).queryByRole("link", { name: /Apply/ })).not.toBeInTheDocument(); // do not send people to a dead posting
    expect(within(gone).queryByRole("link", { name: "Backend Engineer" })).not.toBeInTheDocument(); // not in current matches
    expect(within(gone).getByText(/removed by the employer/)).toBeInTheDocument();
  });

  it("filters on the server and says when nothing matches", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Platform Engineer");
    savedJobs.mockImplementation(async (p: { status?: string }) => (p.status === "offer" ? [] : SAVED_JOBS));
    const filters = within(screen.getByRole("search", { name: "Filter saved jobs" }));
    await user.selectOptions(filters.getByLabelText("Status"), "offer");
    await waitFor(() => expect(savedJobs).toHaveBeenLastCalledWith(expect.objectContaining({ status: "offer" })));
    expect(await screen.findByText("No saved jobs match")).toBeInTheDocument();
    await user.selectOptions(filters.getByLabelText("Listing"), "false");
    await waitFor(() => expect(savedJobs).toHaveBeenLastCalledWith(expect.objectContaining({ listed: false })));
    await user.selectOptions(filters.getByLabelText("Sort by"), "company");
    await waitFor(() => expect(savedJobs).toHaveBeenLastCalledWith(expect.objectContaining({ sort: "company" })));
    await user.type(filters.getByLabelText("Search"), "orbit");
    await waitFor(() => expect(savedJobs).toHaveBeenLastCalledWith(expect.objectContaining({ q: "orbit" })));
  });

  it("changes status and saves notes when the field loses focus", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.selectOptions(await screen.findByLabelText("Status for Platform Engineer at Lumen Labs"), "interview");
    await waitFor(() => expect(updateSavedJob).toHaveBeenCalledWith(11, { status: "interview" }));
    const notes = screen.getByLabelText("Notes for Platform Engineer at Lumen Labs");
    await user.type(notes, " Call Friday.");
    expect(updateSavedJob).toHaveBeenCalledTimes(1); // not on every keystroke
    await user.tab();
    await waitFor(() => expect(updateSavedJob).toHaveBeenCalledWith(11, { notes: "Referred by Dana. Call Friday." }));
  });

  it("removing asks first because it deletes the notes too", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("button", { name: "Remove Platform Engineer from saved jobs" }));
    expect(unsaveJob).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Keep it" }));
    await user.click(screen.getByRole("button", { name: "Remove Platform Engineer from saved jobs" }));
    await user.click(screen.getByRole("button", { name: /Remove and delete notes/ }));
    await waitFor(() => expect(unsaveJob).toHaveBeenCalledWith(11));
  });

  it("has an empty state that points at the dashboard", async () => {
    savedJobs.mockResolvedValue([]);
    renderPage();
    expect(await screen.findByText("No saved jobs yet")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Browse matches" })).toHaveAttribute("href", "/dashboard");
  });

  it("offers to move browser-only saves to the account once, keeping the ones that could not move", async () => {
    localStorage.setItem("nextrole_saved_jobs", JSON.stringify({ v: 1, ids: ["s1", "old"] }));
    localStorage.setItem("nextrole_tracker", JSON.stringify({ v: 1, jobs: [{ id: "s1", status: "applied", note: "hi" }] }));
    importSavedJobs.mockResolvedValue({ imported: 1, skipped: ["old"] });
    const user = userEvent.setup();
    renderPage();
    expect(await screen.findByText("2 saved jobs found in this browser")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Move to my account" }));
    await waitFor(() => expect(importSavedJobs).toHaveBeenCalledWith([
      { job_id: "s1", status: "applied", notes: "hi" }, { job_id: "old", status: "saved", notes: "" }]));
    expect(await screen.findByText("1 saved job found in this browser")).toBeInTheDocument(); // only "old" remains
    expect(JSON.parse(localStorage.getItem("nextrole_saved_jobs")!).ids).toEqual(["old"]);
  });
});
