import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const replace = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }));
const me = vi.fn();
const deleteAccount = vi.fn();
const logout = vi.fn();
const exportData = vi.fn();
vi.mock("@/lib/api/endpoints", () => ({ api: { me: () => me(), deleteAccount: () => deleteAccount(), logout: () => logout(), exportData: () => exportData() } }));

import { ApiError } from "@/lib/api/client";
import { DisplayPrefsEffect } from "@/components/display-prefs-effect";
import { DEFAULT_PREFS, setDisplayPrefs } from "@/lib/local/display-prefs";
import { SettingsPage } from "./settings-page";

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={qc}><DisplayPrefsEffect /><SettingsPage /></QueryClientProvider>);
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  setDisplayPrefs(DEFAULT_PREFS);
  delete document.documentElement.dataset.motion;
  me.mockResolvedValue({ email: "priya@example.com" });
  deleteAccount.mockResolvedValue(undefined);
  logout.mockResolvedValue(undefined);
});

describe("Settings", () => {
  it("shows who is signed in", async () => {
    renderPage();
    expect(await screen.findByText("priya@example.com")).toBeInTheDocument();
  });

  it("downloads the user's data as a JSON file", async () => {
    exportData.mockResolvedValue({ account: { email: "priya@example.com" }, profile: { name: "Priya" } });
    const createObjectURL = vi.fn((_blob: Blob) => "blob:fake");
    const revoke = vi.fn();
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL, revokeObjectURL: revoke }));
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("button", { name: /download my data/i }));
    await waitFor(() => expect(click).toHaveBeenCalled());
    expect(exportData).toHaveBeenCalledOnce();
    const blob = createObjectURL.mock.calls[0][0];
    expect(JSON.parse(await blob.text()).profile.name).toBe("Priya");
    expect(revoke).toHaveBeenCalledWith("blob:fake");
    click.mockRestore();
    vi.unstubAllGlobals();
  });

  it("offers the theme choice and keeps the stored value on screen", async () => {
    renderPage();
    expect(await screen.findByRole("radio", { name: /match my device/i })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /^light/i })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /^dark/i })).toBeInTheDocument();
  });

  it("'always reduce motion' is saved and applied to the page immediately", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("radio", { name: /always reduce motion/i }));
    expect(JSON.parse(localStorage.getItem("nextrole_display")!)).toMatchObject({ motion: "reduced" });
    await waitFor(() => expect(document.documentElement.dataset.motion).toBe("reduced"));
    await user.click(screen.getByRole("radio", { name: /follow my device/i }));
    await waitFor(() => expect(document.documentElement.dataset.motion).toBeUndefined());
  });

  it("clears only browser data after confirmation, and keeps display settings", async () => {
    localStorage.setItem("nextrole_saved_jobs", JSON.stringify({ v: 1, ids: ["a"] }));
    localStorage.setItem("nextrole_tracker", JSON.stringify({ v: 1, jobs: [] }));
    setDisplayPrefs({ motion: "reduced" });
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("button", { name: /clear data stored in this browser/i }));
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Clear it" }));
    expect(JSON.parse(localStorage.getItem("nextrole_saved_jobs")!).ids).toEqual([]);
    expect(JSON.parse(localStorage.getItem("nextrole_display")!).motion).toBe("reduced");
    expect(deleteAccount).not.toHaveBeenCalled();
  });

  it("only deletes the account once the confirmation word is typed", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("button", { name: /delete my account and data/i }));
    const dialog = await screen.findByRole("dialog");
    const confirm = within(dialog).getByRole("button", { name: "Delete everything" });
    expect(confirm).toBeDisabled();
    await user.type(within(dialog).getByLabelText(/type "delete"/i), "delet");
    expect(confirm).toBeDisabled();
    await user.type(within(dialog).getByLabelText(/type "delete"/i), "e");
    expect(confirm).toBeEnabled();
    expect(deleteAccount).not.toHaveBeenCalled();
  });

  it("deletes the account, clears the session and local data, and leaves", async () => {
    localStorage.setItem("nextrole_saved_jobs", JSON.stringify({ v: 1, ids: ["a"] }));
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("button", { name: /delete my account and data/i }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText(/type "delete"/i), "DELETE");
    await user.click(within(dialog).getByRole("button", { name: "Delete everything" }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/"));
    expect(deleteAccount).toHaveBeenCalledTimes(1);
    expect(logout).toHaveBeenCalled();
    expect(JSON.parse(localStorage.getItem("nextrole_saved_jobs")!).ids).toEqual([]);
  });

  it("keeps the user here and explains when deletion fails", async () => {
    deleteAccount.mockRejectedValue(new ApiError("server unavailable", 500));
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("button", { name: /delete my account and data/i }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText(/type "delete"/i), "delete");
    await user.click(within(dialog).getByRole("button", { name: "Delete everything" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(/server unavailable/);
    expect(replace).not.toHaveBeenCalled();
  });

  it("is honest about the model provider and about what stays in the browser", async () => {
    renderPage();
    expect(await screen.findByText(/AI model provider this NextRole is set up with/i)).toBeInTheDocument();
    expect(screen.getByText(/never leave this device/i)).toBeInTheDocument();
  });
});
