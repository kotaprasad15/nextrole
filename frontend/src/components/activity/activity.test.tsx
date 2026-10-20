import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PAST_RUNS } from "@/lib/api/mock/data";
import { RunDetailSchema, RunSummarySchema, type RunDetail as RunDetailT } from "@/lib/api/schemas";

const runs = vi.fn();
const runFn = vi.fn();
vi.mock("@/lib/api/endpoints", () => ({ api: { runs: () => runs(), run: (id: string) => runFn(id) } }));
const liveStream = { events: [] as unknown[], status: "idle", finished: null as unknown };
vi.mock("@/lib/api/sse", () => ({ useRunEvents: (id: string | null) => (id ? liveStream : { events: [], status: "idle", finished: null }) }));

import { ApiError } from "@/lib/api/client";
import { ActivityList } from "./activity-list";
import { RunDetail } from "./run-detail";

const details = PAST_RUNS.map((r) => RunDetailSchema.parse(r));
const summaries = details.map((d) => RunSummarySchema.parse(d));
const [recommendRun, outreachRun, failedRun] = details;

const wrap = (ui: React.ReactElement) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
};

beforeEach(() => {
  vi.clearAllMocks();
  runs.mockResolvedValue(summaries);
  runFn.mockImplementation(async (id: string) => details.find((d) => d.id === id));
  liveStream.events = [];
  liveStream.finished = null;
});

describe("ActivityList", () => {
  it("shows totals, success rate and a row per run linking to its trace", async () => {
    wrap(<ActivityList />);
    expect(await screen.findByText("Finished successfully")).toBeInTheDocument();
    expect(screen.getByText("67%")).toBeInTheDocument(); // 2 of 3 completed
    const link = screen.getByRole("link", { name: "Write outreach" });
    expect(link).toHaveAttribute("href", `/activity/${outreachRun.id}`);
    expect(screen.getAllByText("Completed", { selector: "span" })).toHaveLength(2);
    expect(screen.getAllByText("Failed", { selector: "span" })).toHaveLength(1);
    expect(screen.getByText(/doesn't read LinkedIn/)).toBeInTheDocument(); // failed run's reason
  });

  it("filters by run type", async () => {
    const user = userEvent.setup();
    wrap(<ActivityList />);
    await screen.findByText("Finished successfully");
    await user.click(screen.getByRole("radio", { name: /Pasted job \(1\)/ }));
    expect(screen.getByRole("link", { name: "Pasted job" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Write outreach" })).not.toBeInTheDocument();
  });

  it("explains an empty history and a load error", async () => {
    runs.mockResolvedValueOnce([]);
    const { unmount } = wrap(<ActivityList />);
    expect(await screen.findByText("No runs yet")).toBeInTheDocument();
    unmount();
    runs.mockRejectedValueOnce(new ApiError("boom", 500));
    wrap(<ActivityList />);
    expect(await screen.findByRole("alert")).toHaveTextContent(/could not load your activity/i);
  });
});

describe("RunDetail", () => {
  it("shows a lane per step including the rewrite attempt, with timing and totals", async () => {
    wrap(<RunDetail runId={outreachRun.id} />);
    expect(await screen.findByRole("heading", { level: 1, name: "Write outreach" })).toBeInTheDocument();
    expect(screen.getByText("Writing the draft (attempt 2)")).toBeInTheDocument();
    expect(screen.getByText("Researching the company")).toBeInTheDocument();
    expect(screen.getByText("14,820")).toBeInTheDocument(); // total tokens
    expect(screen.getByText("7/7")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /open the draft/i })).toHaveAttribute("href", "/jobs/s1/outreach");
  });

  it("explains why a failed run failed", async () => {
    wrap(<RunDetail runId={failedRun.id} />);
    expect(await screen.findByRole("alert")).toHaveTextContent(/did not finish/i);
    expect(screen.getByRole("alert")).toHaveTextContent(/LinkedIn, Indeed or Naukri/);
  });

  it("replays a finished run step by step and can jump back to the full run", async () => {
    const user = userEvent.setup();
    wrap(<RunDetail runId={recommendRun.id} />);
    await screen.findByRole("heading", { level: 1, name: "Find matches" });
    const total = recommendRun.events.length;
    expect(screen.getByText(`${total}/${total}`)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "4x" }));
    await user.click(screen.getByRole("button", { name: "Replay" }));
    // Replay starts from the first event, so late steps are not done yet.
    expect(screen.getByText(/^\d+\/\d+$/, { selector: "output" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(`${total}/${total}`, { selector: "output" })).toBeInTheDocument(), { timeout: 8000 });
    await waitFor(() => expect(screen.getByRole("button", { name: "Replay" })).toBeInTheDocument());
  }, 15000);

  it("scrubbing shows only the steps reached so far", async () => {
    wrap(<RunDetail runId={recommendRun.id} />);
    await screen.findByRole("heading", { level: 1, name: "Find matches" });
    const slider = screen.getByRole("slider", { name: "Replay position" });
    fireEvent.change(slider, { target: { value: "4" } }); // run_started, plan, discover started + finished
    const lanes = screen.getAllByRole("listitem");
    const discover = lanes.find((l) => within(l).queryByText("Finding openings"))!;
    expect(within(discover).getByText("(done)")).toBeInTheDocument();
    const match = lanes.find((l) => within(l).queryByText("Scoring against your profile"))!;
    expect(within(match).getByText("(waiting)")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Resume" })).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "Show full run" }));
    expect(screen.getByText(`${recommendRun.events.length}/${recommendRun.events.length}`, { selector: "output" })).toBeInTheDocument();
  });

  it("follows a run that is still going", async () => {
    const live: RunDetailT = { ...outreachRun, status: "running", finished_at: null, events: outreachRun.events.slice(0, 5) };
    runFn.mockResolvedValue(live);
    liveStream.events = outreachRun.events.slice(0, 7);
    wrap(<RunDetail runId={outreachRun.id} />);
    expect(await screen.findByText(/live: updating as it runs/i)).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: /replay this run/i })).not.toBeInTheDocument();
  });

  it("handles a missing run", async () => {
    runFn.mockRejectedValue(new ApiError("run not found", 404));
    wrap(<RunDetail runId="nope" />);
    expect(await screen.findByText("Run not found")).toBeInTheDocument();
  });
});
