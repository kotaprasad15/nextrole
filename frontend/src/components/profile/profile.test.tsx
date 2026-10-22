import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { JobCard, Profile, Recommendations } from "@/lib/api/schemas";

const profileFn = vi.fn();
const saveProfile = vi.fn();
const recommendations = vi.fn();
vi.mock("@/lib/api/endpoints", () => ({ api: { profile: () => profileFn(), saveProfile: (p: unknown) => saveProfile(p), recommendations: () => recommendations() } }));

import { ApiError } from "@/lib/api/client";
import { ProfilePage } from "./profile-page";

const job = (id: string, o: Partial<JobCard> = {}): JobCard => ({
  job_id: id, title: `Role ${id}`, company: "Acme", location: "", remote: false, score: 70, rationale: "", strengths: [], gaps: [],
  apply_url: "https://acme.com/apply", pasted: false, ...o,
});
const RECS: Recommendations = { startup: [job("s1")], mid: [job("m1")], mnc: [] };

const PROFILE: Profile = {
  name: "Priya Nair", summary: "Backend engineer.", skills: ["Python", "SQL"],
  experience: [{ company: "Finlytics", title: "Intern", start: "Jun 2025", end: "Sep 2025", bullets: ["Built APIs"] }],
  projects: [], education: [{ institution: "Leeds", degree: "BSc", year: "2026" }],
  preferences: { roles: ["Backend Engineer"], locations: ["Leeds"], remote_ok: true, experience_level: "Mid", extras: "" },
};

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={qc}><ProfilePage /></QueryClientProvider>);
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  profileFn.mockResolvedValue(PROFILE);
  recommendations.mockResolvedValue(RECS);
});

const startEdit = async (user: ReturnType<typeof userEvent.setup>) => user.click(await screen.findByRole("button", { name: /edit profile/i }));

describe("Profile editing", () => {
  it("opens read-only: values are shown, nothing is editable, there is no save bar", async () => {
    renderPage();
    const name = await screen.findByLabelText("Name");
    expect(name).toHaveValue("Priya Nair");
    expect(name).toBeDisabled();
    expect(screen.getByLabelText("Company")).toHaveValue("Finlytics");
    expect(screen.getByLabelText("Company")).toBeDisabled();
    expect(screen.getByRole("button", { name: /add experience/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Edit profile" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: /unsaved|editing/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save changes" })).not.toBeInTheDocument();
  });

  it("preferences are read-only too until Edit is chosen", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByLabelText("Name");
    await user.click(screen.getByRole("tab", { name: "Preferences" }));
    expect(await screen.findByRole("switch", { name: /open to remote/i })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Edit profile" }));
    expect(screen.getByRole("switch", { name: /open to remote/i })).toBeEnabled();
  });

  it("Edit switches to edit mode with Save and Cancel", async () => {
    const user = userEvent.setup();
    renderPage();
    await startEdit(user);
    expect(screen.getByLabelText("Name")).toBeEnabled();
    expect(screen.getByRole("region", { name: /unsaved|editing/i })).toHaveTextContent("Editing your profile");
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled(); // nothing changed yet
    expect(screen.getByRole("button", { name: "Cancel" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Edit profile" })).not.toBeInTheDocument();
  });

  it("saves edits (trimmed, blanks dropped) with PUT /profile and returns to read-only", async () => {
    saveProfile.mockImplementation(async (p) => p);
    const user = userEvent.setup();
    renderPage();
    await startEdit(user);
    const name = screen.getByLabelText("Name");
    await user.clear(name);
    await user.type(name, "  Priya N.  ");
    await user.click(screen.getByRole("button", { name: "Add a bullet" }));
    expect(screen.getByRole("region", { name: /unsaved/i })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(saveProfile).toHaveBeenCalled());
    const sent = saveProfile.mock.calls[0][0] as Profile;
    expect(sent.name).toBe("Priya N.");
    expect(sent.experience[0].bullets).toEqual(["Built APIs"]); // the empty new bullet was dropped
    await waitFor(() => expect(screen.getByLabelText("Name")).toBeDisabled());
    expect(screen.getByRole("button", { name: "Edit profile" })).toBeInTheDocument();
  });

  it("blocks saving invalid data and jumps to the tab with the problem", async () => {
    const user = userEvent.setup();
    renderPage();
    await startEdit(user);
    await user.click(screen.getByRole("tab", { name: "Preferences" }));
    await user.click(await screen.findByRole("button", { name: "Remove role Backend Engineer" }));
    await user.click(screen.getByRole("tab", { name: "Profile" }));
    await user.clear(await screen.findByLabelText("Name"));
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect(saveProfile).not.toHaveBeenCalled();
    expect(await screen.findByText("Add your name.")).toBeInTheDocument();
    expect(screen.getByText(/Fix 2 fields to save/)).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "Preferences" }));
    expect(await screen.findByText(/keep at least one role/i)).toBeInTheDocument();
  });

  it("cancel with no changes leaves edit mode immediately", async () => {
    const user = userEvent.setup();
    renderPage();
    await startEdit(user);
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toBeDisabled();
  });

  it("cancel with unsaved changes asks first; keep editing preserves them, discard restores the saved profile", async () => {
    const user = userEvent.setup();
    renderPage();
    await startEdit(user);
    await user.type(screen.getByLabelText("Name"), "x");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    const dialog = await screen.findByRole("dialog", { name: /discard your changes/i });
    await user.click(within(dialog).getByRole("button", { name: "Keep editing" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByLabelText("Name")).toHaveValue("Priya Nairx");
    expect(screen.getByLabelText("Name")).toBeEnabled();

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Discard changes" }));
    await waitFor(() => expect(screen.getByLabelText("Name")).toBeDisabled());
    expect(screen.getByLabelText("Name")).toHaveValue("Priya Nair");
    expect(saveProfile).not.toHaveBeenCalled();
  });

  it("adds and removes an experience entry", async () => {
    const user = userEvent.setup();
    renderPage();
    await startEdit(user);
    await user.click(screen.getByRole("button", { name: /add experience/i }));
    expect(screen.getAllByLabelText("Company")).toHaveLength(2);
    await user.click(screen.getByRole("button", { name: "Remove experience Finlytics" }));
    expect(screen.getAllByLabelText("Company")).toHaveLength(1);
  });

  it("sends a user who has not onboarded to setup", async () => {
    profileFn.mockRejectedValue(new ApiError("no profile yet", 404));
    renderPage();
    expect(await screen.findByRole("link", { name: /start setup/i })).toHaveAttribute("href", "/onboarding");
  });
});

describe("Saved jobs and tracker", () => {
  const saveJob = (id: string) => localStorage.setItem("nextrole_saved_jobs", JSON.stringify({ v: 1, ids: [id, ...(JSON.parse(localStorage.getItem("nextrole_saved_jobs") ?? '{"ids":[]}').ids as string[])] }));

  it("lists saved jobs and lets you start tracking with 'I applied'", async () => {
    saveJob("s1");
    const user = userEvent.setup();
    renderPage();
    await screen.findByLabelText("Name");
    await user.click(screen.getByRole("tab", { name: /Saved jobs/ }));
    expect(await screen.findByRole("link", { name: "Role s1" })).toHaveAttribute("href", "/jobs/s1");
    await user.click(screen.getByRole("button", { name: "I applied" }));
    expect(screen.getByText("Applied", { selector: "span" })).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem("nextrole_tracker")!).jobs[0]).toMatchObject({ id: "s1", status: "applied", title: "Role s1" });
  });

  it("shows saved jobs in the Saved column and moves them with a keyboard-operable menu", async () => {
    saveJob("s1");
    const user = userEvent.setup();
    renderPage();
    await screen.findByLabelText("Name");
    await user.click(screen.getByRole("tab", { name: /Tracker/ }));
    const savedCol = (await screen.findByRole("heading", { name: /^Saved/ })).closest("section")!;
    expect(within(savedCol).getByText("Role s1")).toBeInTheDocument();

    const trigger = within(savedCol).getByRole("button", { name: /Move or remove Role s1/ });
    trigger.focus();
    await user.keyboard("{Enter}");
    await user.click(await screen.findByRole("menuitem", { name: "Move to Interview" }));

    const interviewCol = screen.getByRole("heading", { name: /^Interview/ }).closest("section")!;
    expect(within(interviewCol).getByText("Role s1")).toBeInTheDocument();
    expect(within(savedCol).queryByText("Role s1")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Moved Role s1 to Interview");
  });

  it("removing a card clears both the tracker entry and the bookmark", async () => {
    saveJob("s1");
    const user = userEvent.setup();
    renderPage();
    await screen.findByLabelText("Name");
    await user.click(screen.getByRole("tab", { name: /Tracker/ }));
    await user.click(await screen.findByRole("button", { name: /Move or remove Role s1/ }));
    await user.click(await screen.findByRole("menuitem", { name: "Remove from tracker" }));
    expect(JSON.parse(localStorage.getItem("nextrole_saved_jobs")!).ids).toEqual([]);
    expect(await screen.findByText("Nothing tracked yet")).toBeInTheDocument();
  });

  it("explains the empty states", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByLabelText("Name");
    await user.click(screen.getByRole("tab", { name: /Saved jobs/ }));
    expect(await screen.findByText("No saved jobs")).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: /Tracker/ }));
    expect(await screen.findByText("Nothing tracked yet")).toBeInTheDocument();
  });
});
