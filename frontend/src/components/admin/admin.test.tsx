import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api/client";
import { MetricsSchema, type Metrics } from "@/lib/api/schemas";

const adminMetrics = vi.fn();
const adminTraces = vi.fn();
const adminTrace = vi.fn();
vi.mock("@/lib/api/endpoints", () => ({ api: { adminMetrics: (d: number) => adminMetrics(d), adminTraces: () => adminTraces(), adminTrace: (id: string) => adminTrace(id) } }));

import { AdminPage } from "./admin-page";

const totals = { llm_requests: 1200, llm_errors: 24, error_rate: 0.02, tokens_in: 800_000, tokens_out: 200_000, tokens: 1_000_000, cost_usd: 12.5, avg_latency_ms: 2100.4 };
const METRICS: Metrics = {
  range: { days: 3, from: "2026-10-18", to: "2026-10-20" },
  totals,
  previous: { ...totals, cost_usd: 10, tokens: 1_000_000, llm_requests: 1500, error_rate: 0.01 },
  by_model: [
    { name: "claude-sonnet-5-5", requests: 400, errors: 10, error_rate: 0.025, tokens: 700_000, cost_usd: 10 },
    { name: "claude-haiku-5-5", requests: 800, errors: 14, error_rate: 0.0175, tokens: 300_000, cost_usd: 2.5 },
  ],
  by_stage: [{ name: "writer", requests: 300, errors: 5, error_rate: 0.016, tokens: 400_000, cost_usd: 6 }],
  series: [
    { day: "2026-10-18", requests: 100, errors: 1, tokens: 10_000, cost_usd: 1 },
    { day: "2026-10-19", requests: 0, errors: 0, tokens: 0, cost_usd: 0 },
    { day: "2026-10-20", requests: 300, errors: 5, tokens: 30_000, cost_usd: 3 },
  ],
  runs: { total: 40, failed: 2, error_rate: 0.05, by_mode: [{ mode: "single_job", total: 10, failed: 1, completed: 9 }] },
  http: { requests: 5000, client_errors: 100, server_errors: 5, error_rate: 0.001, series: [{ day: "2026-10-18", requests: 10 }, { day: "2026-10-19", requests: 0 }, { day: "2026-10-20", requests: 30 }] },
  alerts: { passes: 4, alerts_created: 7, emails_sent: 2, errors: 0 },
  interviews: { pending: 3, approved: 10, rejected: 1, removed: 0, open_reports: 1 },
  accounts: { total: 42 },
};

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><AdminPage /></QueryClientProvider>);
}

beforeEach(() => {
  vi.clearAllMocks();
  adminMetrics.mockResolvedValue(METRICS);
  adminTraces.mockResolvedValue([{ run_id: "a1b2c3d4", modified: "2026-10-20T10:00:00+00:00", size_bytes: 2048 }]);
  adminTrace.mockResolvedValue([{ agent: "matcher", latency_ms: 812.4, input_tokens: 600, output_tokens: 100, cost_usd: 0.004, error: null }]);
});

describe("Admin usage page", () => {
  it("fixture satisfies the API schema", () => {
    MetricsSchema.parse(METRICS);
  });

  it("shows total cost, tokens, requests and error rate with a trend against the previous period", async () => {
    renderPage();
    const totalsRegion = await screen.findByRole("region", { name: "Totals" });
    expect(totalsRegion).toHaveTextContent("$12.50");
    expect(totalsRegion).toHaveTextContent("25% more");   // cost 12.5 vs 10
    expect(totalsRegion).toHaveTextContent("1M");
    expect(totalsRegion).toHaveTextContent("800K in, 200K out");
    expect(totalsRegion).toHaveTextContent("no change");  // tokens equal
    expect(totalsRegion).toHaveTextContent("20% less");   // requests 1200 vs 1500
    expect(totalsRegion).toHaveTextContent("2.0%");
    expect(totalsRegion).toHaveTextContent("24 of 1,200 failed");
  });

  it("breaks cost down by model and stage, never by person", async () => {
    renderPage();
    const row = (await screen.findByRole("rowheader", { name: /claude-sonnet-5-5/ })).closest("tr")!;
    expect(row).toHaveTextContent("$10.00");
    expect(row).toHaveTextContent("80% of total");
    expect(screen.getByRole("rowheader", { name: "writer" })).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/per user|by user|per person|user id/i);
    expect(document.body.textContent).toContain("No figure on this page can be broken down by person");
  });

  it("draws the daily trends with the numbers also available as tables", async () => {
    renderPage();
    const chart = await screen.findByRole("img", { name: /Cost per day: \$4\.00 in 3 days, peak \$3\.00/ });
    expect(chart.querySelectorAll("rect")).toHaveLength(3);
    const table = screen.getByRole("table", { name: "Cost per day by day" });
    expect(within(table).getAllByRole("row")).toHaveLength(4);
  });

  it("changes the range and asks the server for it", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole("region", { name: "Totals" });
    expect(adminMetrics).toHaveBeenLastCalledWith(30);
    await user.click(screen.getByRole("radio", { name: "7 days" }));
    await waitFor(() => expect(adminMetrics).toHaveBeenLastCalledWith(7));
  });

  it("shows traces and opens one", async () => {
    const user = userEvent.setup();
    renderPage();
    const list = await screen.findByRole("list", { name: "Recent traces" });
    await user.click(within(list).getByRole("button", { name: /View trace a1b2c3d4/ }));
    expect(await screen.findByRole("rowheader", { name: "matcher" })).toBeInTheDocument();
    expect(adminTrace).toHaveBeenCalledWith("a1b2c3d4");
  });

  it("says 'not found' when the server refuses (a member who typed the address)", async () => {
    adminMetrics.mockRejectedValue(new ApiError("not found", 404));
    renderPage();
    expect(await screen.findByText("Not found")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Totals" })).not.toBeInTheDocument();
  });

  it("shows an empty-data dashboard without breaking", async () => {
    adminMetrics.mockResolvedValue({ ...METRICS, totals: { ...totals, llm_requests: 0, llm_errors: 0, error_rate: 0, tokens: 0, tokens_in: 0, tokens_out: 0, cost_usd: 0 },
      previous: { ...totals, llm_requests: 0, tokens: 0, cost_usd: 0, error_rate: 0 }, by_model: [], by_stage: [], series: METRICS.series.map((s) => ({ ...s, requests: 0, errors: 0, tokens: 0, cost_usd: 0 })) });
    renderPage();
    expect(await screen.findByText("No model calls in this period.")).toBeInTheDocument();
    expect(screen.getAllByText("no earlier data to compare").length).toBeGreaterThan(0);
  });
});
