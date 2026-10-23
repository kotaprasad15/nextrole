import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { JobCard, Profile, Recommendations } from "@/lib/api/schemas";

const profileFn = vi.fn();
const saveProfile = vi.fn();
const recommendations = vi.fn();
const companies = vi.fn();
const companySuggestions = vi.fn();
const addCompany = vi.fn();
const removeCompany = vi.fn();
vi.mock("@/lib/api/endpoints", () => ({
  api: {
    profile: () => profileFn(), saveProfile: (p: unknown) => saveProfile(p), recommendations: () => recommendations(),
    companies: () => companies(), companySuggestions: (q: string) => companySuggestions(q), addCompany: (n: string) => addCompany(n),
    removeCompany: (id: number) => removeCompany(id),
    resolveRoles: async (roles: string[]) => roles.map((text) => ({ text, canonical: "backend_engineer", label: "Backend Engineer", also_matches: ["backend developer"] })),
  },
}));

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
  companies.mockResolvedValue([]);
  companySuggestions.mockResolvedValue([]);
  addCompany.mockImplementation(async (name: string) => ({ id: 9, name, monitored: true }));
  removeCompany.mockResolvedValue(undefined);
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

describe("Preferences: how roles are read, and companies to watch", () => {
  const openPrefs = async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByLabelText("Name");
    await user.click(screen.getByRole("tab", { name: "Preferences" }));
    return user;
  };

  it("explains what each wanted role means to the matcher", async () => {
    await openPrefs();
    const box = await screen.findByText("How we read your roles");
    const section = box.closest("div")!;
    expect(await within(section).findByText(/counts as/)).toHaveTextContent("Backend Engineer counts as Backend Engineer");
  });

  it("lists watched companies, flags ones we cannot watch, and removes one", async () => {
    companies.mockResolvedValue([{ id: 1, name: "Stripe", monitored: true }, { id: 2, name: "Tiny Co", monitored: false }]);
    const user = await openPrefs();
    const list = await screen.findByRole("list", { name: "Watched companies" });
    expect(within(list).getByText("Stripe")).toBeInTheDocument();
    expect(within(list).getByText("not watchable yet")).toBeInTheDocument();
    await user.click(within(list).getByRole("button", { name: "Stop watching Tiny Co" }));
    await waitFor(() => expect(removeCompany).toHaveBeenCalledWith(2));
  });

  it("adds a typed company and a suggested one, even outside edit mode", async () => {
    companySuggestions.mockResolvedValue(["Airbnb", "Figma"]);
    const user = await openPrefs();
    expect(screen.queryByRole("button", { name: "Save changes" })).not.toBeInTheDocument(); // not editing the profile
    await user.type(await screen.findByLabelText("Add a company"), "Initech");
    await user.click(screen.getByRole("button", { name: /^Add$/ }));
    await waitFor(() => expect(addCompany).toHaveBeenCalledWith("Initech"));
    await user.click(await screen.findByRole("button", { name: "+ Airbnb" }));
    await waitFor(() => expect(addCompany).toHaveBeenCalledWith("Airbnb"));
  });

  it("shows a friendly empty state", async () => {
    await openPrefs();
    expect(await screen.findByText("You are not watching any company yet.")).toBeInTheDocument();
  });
});
