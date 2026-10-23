import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api/client";
import { AdminInterviewSchema, type AdminInterview } from "@/lib/api/schemas";

const moderationQueue = vi.fn();
const moderate = vi.fn();
const moderationReports = vi.fn();
const dismissReport = vi.fn();
vi.mock("@/lib/api/endpoints", () => ({
  api: {
    moderationQueue: (s: string) => moderationQueue(s), moderate: (...a: unknown[]) => moderate(...a),
    moderationReports: () => moderationReports(), dismissReport: (id: number) => dismissReport(id),
  },
}));

import { ModerationPage } from "./moderation-page";

const base: AdminInterview = {
  id: 1, company: "Acme", role: "Software Engineer", level: "mid", interviewed_on: "2026-08", difficulty: 3, outcome: "offer",
  rounds: [{ type: "coding", difficulty: 3, notes: "Two graph problems." }], tips: "Practise.", created_at: "2026-09-01T09:00:00+00:00",
  author: null, mine: false, upvotes: 0, upvoted: false, status: "pending", moderator_note: "", author_id: 7, open_reports: 0,
  auto_check: { flags: [], llm: { pii: false, attack: false, confidential: false, risk: "low", reasons: [] }, llm_status: "ok", risk: "low" },
};
const risky: AdminInterview = {
  ...base, id: 2, company: "Globex", open_reports: 2,
  auto_check: { flags: [{ code: "confidential", severity: "review", detail: "mentions confidentiality or NDA material" }], llm: { pii: false, attack: false, confidential: true, risk: "high", reasons: ["quotes the assessment"] }, llm_status: "ok", risk: "high" },
};

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={qc}><ModerationPage /></QueryClientProvider>);
}

beforeEach(() => {
  vi.clearAllMocks();
  moderationQueue.mockResolvedValue([risky, base]);
  moderationReports.mockResolvedValue([{ id: 5, exp_id: 1, reason: "pii", detail: "has a name", created_at: "2026-09-02T09:00:00+00:00", company: "Acme", role: "Software Engineer", exp_status: "approved" }]);
  moderate.mockImplementation(async (id: number, action: string) => ({ ...base, id, status: action === "approve" ? "approved" : "rejected" }));
  dismissReport.mockResolvedValue(undefined);
});

describe("Moderation page", () => {
  it("fixtures satisfy the API schema", () => {
    AdminInterviewSchema.parse(base);
    AdminInterviewSchema.parse(risky);
  });

  it("lists the queue with risk, automated findings and report counts", async () => {
    renderPage();
    const first = (await screen.findByRole("heading", { level: 2, name: "Globex" })).closest("li")!;
    expect(first).toHaveTextContent("Risk: high");
    expect(first).toHaveTextContent("2 reports");
    expect(within(first).getByRole("list", { name: "Automated findings" })).toHaveTextContent("confidential: mentions confidentiality or NDA material");
    expect(first).toHaveTextContent("AI check: quotes the assessment");
    const second = screen.getByRole("heading", { level: 2, name: "Acme" }).closest("li")!;
    expect(second).toHaveTextContent("Risk: low");
    expect(second).toHaveTextContent("No automated findings.");
  });

  it("approves, and rejects with a note to the author", async () => {
    const user = userEvent.setup();
    renderPage();
    const acme = (await screen.findByRole("heading", { level: 2, name: "Acme" })).closest("li")!;
    await user.click(within(acme).getByRole("button", { name: /Approve/ }));
    await waitFor(() => expect(moderate).toHaveBeenCalledWith(1, "approve", ""));
    const globex = screen.getByRole("heading", { level: 2, name: "Globex" }).closest("li")!;
    await user.type(within(globex).getByLabelText("Note about the post on Globex"), "Too specific about the assessment.");
    await user.click(within(globex).getByRole("button", { name: /Reject/ }));
    await waitFor(() => expect(moderate).toHaveBeenCalledWith(2, "reject", "Too specific about the assessment."));
  });

  it("shows reports and dismisses one", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole("radio", { name: "Reports" }));
    const list = await screen.findByRole("list", { name: "Open reports" });
    expect(list).toHaveTextContent("Acme: Software Engineer");
    expect(list).toHaveTextContent("Shares personal details · has a name");
    await user.click(within(list).getByRole("button", { name: "Dismiss the report about Acme" }));
    await waitFor(() => expect(dismissReport).toHaveBeenCalledWith(5));
  });

  it("offers Remove on published posts", async () => {
    moderationQueue.mockImplementation(async (s: string) => (s === "approved" ? [{ ...base, status: "approved" }] : []));
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole("radio", { name: "Published" }));
    await user.click(await screen.findByRole("button", { name: "Remove" }));
    await waitFor(() => expect(moderate).toHaveBeenCalledWith(1, "remove", ""));
  });

  it("says 'not found' when the server refuses (a non-admin who typed the address)", async () => {
    moderationQueue.mockRejectedValue(new ApiError("not found", 404));
    renderPage();
    expect(await screen.findByText("Not found")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Approve/ })).not.toBeInTheDocument();
  });

  it("has an empty state", async () => {
    moderationQueue.mockResolvedValue([]);
    renderPage();
    expect(await screen.findByText("Nothing to review")).toBeInTheDocument();
  });
});
