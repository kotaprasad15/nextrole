import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api/client";
import { InterviewSchema, type Interview } from "@/lib/api/schemas";
import { experienceFormSchema, personalDataProblems } from "@/lib/interviews";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, replace: vi.fn() }) }));
const interviews = vi.fn();
const myInterviews = vi.fn();
const upvoteInterview = vi.fn();
const reportInterview = vi.fn();
const submitInterview = vi.fn();
const editInterview = vi.fn();
const deleteInterview = vi.fn();
vi.mock("@/lib/api/endpoints", () => ({
  api: {
    interviews: (p: unknown) => interviews(p), myInterviews: () => myInterviews(), upvoteInterview: (id: number, on: boolean) => upvoteInterview(id, on),
    reportInterview: (...a: unknown[]) => reportInterview(...a), submitInterview: (b: unknown) => submitInterview(b), editInterview: (id: number, b: unknown) => editInterview(id, b),
    deleteInterview: (id: number) => deleteInterview(id),
  },
}));

import { Toaster } from "@/components/ui/toast";
import { ExperienceForm } from "./experience-form";
import { InterviewsPage } from "./interviews-page";

const EXP: Interview = {
  id: 1, company: "Acme", role: "Software Engineer", level: "mid", interviewed_on: "2026-08", difficulty: 4, outcome: "offer",
  rounds: [{ type: "coding", difficulty: 3, notes: "Two graph problems." }, { type: "system_design", difficulty: 5, notes: "Rate limiter." }],
  tips: "Explain your trade-offs.", created_at: "2026-09-01T09:00:00+00:00", author: "Sam", mine: false, upvotes: 2, upvoted: false,
};
const MINE: Interview = { ...EXP, id: 2, company: "Initech", mine: true, author: null, status: "rejected", moderator_note: "Too specific about the assessment.", upvotes: 0 };

function renderWith(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}<Toaster /></QueryClientProvider>);
}

beforeEach(() => {
  vi.clearAllMocks();
  window.history.pushState({}, "", "/interviews");
  interviews.mockResolvedValue({ items: [EXP], total: 1, page: 1, page_size: 20 });
  myInterviews.mockResolvedValue([MINE]);
  upvoteInterview.mockImplementation(async (_id: number, on: boolean) => ({ ...EXP, upvoted: on, upvotes: on ? 3 : 2 }));
  reportInterview.mockResolvedValue({ message: "Thank you. A moderator will review this post." });
  submitInterview.mockResolvedValue({ id: 9, status: "pending", message: "Thanks! A moderator reviews every post before it is published." });
});

describe("interview validation helpers", () => {
  it("fixtures satisfy the API schema", () => {
    InterviewSchema.parse(EXP);
    InterviewSchema.parse(MINE);
  });
  it("detects personal data the server would refuse", () => {
    expect(personalDataProblems("write to jane@example.com or +44 20 7946 0958 or www.example.com/x")).toEqual(["email addresses", "phone numbers", "links"]);
    expect(personalDataProblems("Two medium graph problems in 45 minutes")).toEqual([]);
  });
  it("the form schema enforces the same rules as the server", () => {
    const ok = { company: "Acme", role: "SDE", level: "mid", interviewed_on: "2026-01", rounds: [{ type: "coding", difficulty: 3, notes: "graphs" }], difficulty: 3, outcome: "offer", tips: "", anonymous: true };
    expect(experienceFormSchema.safeParse(ok).success).toBe(true);
    expect(experienceFormSchema.safeParse({ ...ok, interviewed_on: "2999-01" }).success).toBe(false);
    expect(experienceFormSchema.safeParse({ ...ok, rounds: [] }).success).toBe(false);
    expect(experienceFormSchema.safeParse({ ...ok, rounds: [{ ...ok.rounds[0], notes: "" }] }).success).toBe(false); // needs substance
    expect(experienceFormSchema.safeParse({ ...ok, tips: "mail me@x.com" }).success).toBe(false);
  });
});

describe("Interviews page", () => {
  it("shows the confidentiality notice and the experience as plain text", async () => {
    renderWith(<InterviewsPage />);
    expect(screen.getByRole("complementary", { name: "What not to share" })).toHaveTextContent("do not share confidential or proprietary company information");
    const card = (await screen.findByRole("heading", { level: 2, name: "Acme" })).closest("li")!;
    expect(card).toHaveTextContent("Software Engineer · Mid-level · August 2026");
    expect(card).toHaveTextContent("Round 2: System design");
    expect(card).toHaveTextContent("Shared by Sam");
    expect(card).toHaveTextContent("Got an offer");
  });

  it("renders markup in a post as text, never as HTML", async () => {
    interviews.mockResolvedValue({ items: [{ ...EXP, tips: '<img src=x onerror="alert(1)"><b>bold</b>' }], total: 1, page: 1, page_size: 20 });
    const { container } = renderWith(<InterviewsPage />);
    await screen.findByText(/onerror/);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("b")).toBeNull();
  });

  it("sends filters to the server and resets to page 1", async () => {
    const user = userEvent.setup();
    renderWith(<InterviewsPage />);
    await screen.findByText("Acme");
    await user.type(screen.getByLabelText("Company"), "acme");
    await waitFor(() => expect(interviews).toHaveBeenLastCalledWith(expect.objectContaining({ company: "acme", page: 1 })));
    await user.type(screen.getByLabelText("Role"), "SDE");
    await user.selectOptions(screen.getByLabelText("Difficulty"), "4");
    await user.selectOptions(screen.getByLabelText("Sort by"), "helpful");
    await waitFor(() => expect(interviews).toHaveBeenLastCalledWith(expect.objectContaining({ role: "SDE", difficulty: "4", sort: "helpful" })));
  });

  it("upvotes a post and shows the new count as pressed", async () => {
    const user = userEvent.setup();
    renderWith(<InterviewsPage />);
    upvoteInterview.mockImplementation(async () => {
      interviews.mockResolvedValue({ items: [{ ...EXP, upvoted: true, upvotes: 3 }], total: 1, page: 1, page_size: 20 }); // what the refetch returns
      return { ...EXP, upvoted: true, upvotes: 3 };
    });
    await user.click(await screen.findByRole("button", { name: /Helpful \(2\)/ }));
    await waitFor(() => expect(upvoteInterview).toHaveBeenCalledWith(1, true));
    expect(await screen.findByRole("button", { name: /Helpful \(3\)/ })).toHaveAttribute("aria-pressed", "true");
  });

  it("reports a post with a reason", async () => {
    const user = userEvent.setup();
    renderWith(<InterviewsPage />);
    await user.click(await screen.findByRole("button", { name: "Report the post about Acme" }));
    const dialog = await screen.findByRole("dialog", { name: "Report this post" });
    await user.selectOptions(within(dialog).getByLabelText("What is wrong?"), "confidential");
    await user.type(within(dialog).getByLabelText(/anything else/i), "Has the exact assessment.");
    await user.click(within(dialog).getByRole("button", { name: "Send report" }));
    await waitFor(() => expect(reportInterview).toHaveBeenCalledWith(1, "confidential", "Has the exact assessment."));
    expect(await screen.findByText("Thank you. A moderator will review this post.")).toBeInTheDocument();
  });

  it("explains empty results versus an empty site", async () => {
    interviews.mockResolvedValue({ items: [], total: 0, page: 1, page_size: 20 });
    const user = userEvent.setup();
    renderWith(<InterviewsPage />);
    expect(await screen.findByText("No experiences yet")).toBeInTheDocument();
    await user.type(screen.getByLabelText("Company"), "zzz");
    expect(await screen.findByText("No experiences match")).toBeInTheDocument();
  });

  it("My posts shows the review status and the moderator's reason, with edit and a two-step delete", async () => {
    const user = userEvent.setup();
    renderWith(<InterviewsPage />);
    await user.click(screen.getByRole("radio", { name: "My posts" }));
    const card = (await screen.findByRole("heading", { level: 2, name: "Initech" })).closest("li")!;
    expect(card).toHaveTextContent("Not published");
    expect(card).toHaveTextContent("Moderator note: Too specific about the assessment.");
    expect(within(card).getByRole("link", { name: /Edit/ })).toHaveAttribute("href", "/interviews/new?edit=2");
    expect(within(card).queryByRole("button", { name: /Helpful/ })).not.toBeInTheDocument();
    deleteInterview.mockResolvedValue(undefined);
    await user.click(within(card).getByRole("button", { name: "Delete your post about Initech" }));
    expect(deleteInterview).not.toHaveBeenCalled();
    await user.click(within(card).getByRole("button", { name: "Delete for good" }));
    await waitFor(() => expect(deleteInterview).toHaveBeenCalledWith(2));
  });
});

describe("Share form", () => {
  async function fill(user: ReturnType<typeof userEvent.setup>) {
    await user.type(screen.getByLabelText("Company"), "Acme");
    await user.type(screen.getByLabelText("Role"), "SDE");
    await user.selectOptions(screen.getByLabelText("Level"), "mid");
    await user.type(screen.getByLabelText("When was the interview?"), "2026-08");
    await user.selectOptions(screen.getByLabelText("Overall difficulty"), "3");
    await user.selectOptions(screen.getByLabelText("Outcome"), "offer");
    await user.type(screen.getByLabelText("Round 1 notes"), "Two graph problems.");
  }

  it("shows the notice, defaults to anonymous, and validates before sending", async () => {
    const user = userEvent.setup();
    renderWith(<ExperienceForm />);
    expect(screen.getByRole("complementary", { name: "What not to share" })).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: /share anonymously/i })).toBeChecked();
    await user.click(screen.getByRole("button", { name: "Submit for review" }));
    expect(await screen.findByText("Enter the company.")).toBeInTheDocument();
    expect(screen.getByText(/confirm you have not included confidential/i)).toBeInTheDocument();
    expect(submitInterview).not.toHaveBeenCalled();
  });

  it("warns about personal data before it ever reaches the server", async () => {
    const user = userEvent.setup();
    renderWith(<ExperienceForm />);
    await fill(user);
    await user.type(screen.getByLabelText(/Tips for the next candidate/), "Ask for jane@example.com");
    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: "Submit for review" }));
    expect(await screen.findByText(/Please remove email addresses/)).toBeInTheDocument();
    expect(submitInterview).not.toHaveBeenCalled();
  });

  it("submits the structured post and returns to the list", async () => {
    const user = userEvent.setup();
    renderWith(<ExperienceForm />);
    await fill(user);
    await user.click(screen.getByRole("button", { name: "Add a round" }));
    await user.selectOptions(screen.getByLabelText("Round 2 type"), "behavioral");
    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: "Submit for review" }));
    await waitFor(() => expect(submitInterview).toHaveBeenCalled());
    const sent = submitInterview.mock.calls[0][0];
    expect(sent).toMatchObject({ company: "Acme", role: "SDE", level: "mid", interviewed_on: "2026-08", difficulty: 3, outcome: "offer", anonymous: true });
    expect(sent.rounds).toHaveLength(2);
    expect(sent.rounds[1].type).toBe("behavioral");
    await waitFor(() => expect(push).toHaveBeenCalledWith("/interviews"));
  });

  it("shows the server's message when it refuses the post", async () => {
    submitInterview.mockRejectedValue(new ApiError("Please remove links (to profiles, documents or websites).", 422));
    const user = userEvent.setup();
    renderWith(<ExperienceForm />);
    await fill(user);
    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: "Submit for review" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Please remove links");
    expect(push).not.toHaveBeenCalled();
  });

  it("edits one of your posts (prefilled) and resubmits it", async () => {
    window.history.pushState({}, "", "/interviews/new?edit=2");
    editInterview.mockResolvedValue({ id: 2, status: "pending", message: "Saved." });
    const user = userEvent.setup();
    renderWith(<ExperienceForm />);
    expect(await screen.findByLabelText("Company")).toHaveValue("Initech");
    expect(screen.getByRole("heading", { level: 1, name: "Edit your experience" })).toBeInTheDocument();
    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: "Save and resubmit" }));
    await waitFor(() => expect(editInterview).toHaveBeenCalledWith(2, expect.objectContaining({ company: "Initech" })));
  });
});
