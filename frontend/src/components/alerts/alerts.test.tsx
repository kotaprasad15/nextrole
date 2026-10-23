import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Toaster } from "@/components/ui/toast";
import { ApiError } from "@/lib/api/client";
import type { Alert, AlertSettings } from "@/lib/api/schemas";
import { AlertSchema, AlertSettingsSchema } from "@/lib/api/schemas";

const alerts = vi.fn();
const readAlert = vi.fn();
const readAllAlerts = vi.fn();
const dismissAlert = vi.fn();
const alertSettings = vi.fn();
const saveAlertSettings = vi.fn();
const checkAlerts = vi.fn();
const companies = vi.fn();
const unsubscribeAlerts = vi.fn();
vi.mock("@/lib/api/endpoints", () => ({
  api: {
    alerts: () => alerts(), readAlert: (id: number) => readAlert(id), readAllAlerts: () => readAllAlerts(), dismissAlert: (id: number) => dismissAlert(id),
    alertSettings: () => alertSettings(), saveAlertSettings: (s: unknown) => saveAlertSettings(s), checkAlerts: () => checkAlerts(),
    companies: () => companies(), unsubscribeAlerts: (t: string) => unsubscribeAlerts(t),
  },
}));

import { AlertsPage } from "./alerts-page";
import { Unsubscribe } from "./unsubscribe";

const A1: Alert = {
  id: 1, job_id: "j1", title: "Software Development Engineer II", company: "Stripe", location: "Remote", remote: true,
  apply_url: "https://boards.example.com/stripe/1", summary: "", role: "SDE",
  why: "It is a Software Engineer role, the same kind of job as your wanted role SDE.", confidence: 0.95, method: "taxonomy",
  created_at: "2026-10-20T08:00:00+00:00", read: false,
};
const A2: Alert = { ...A1, id: 2, title: "Customer Solutions Engineer", company: "Figma", method: "llm", read: true, apply_url: null, why: "Hands-on customer engineering.", role: "Forward Deployed Engineer" };
const SETTINGS: AlertSettings = { in_app: true, email: false, frequency: "daily", email_available: true };

function renderWith(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}<Toaster /></QueryClientProvider>);
}

beforeEach(() => {
  vi.clearAllMocks();
  alerts.mockResolvedValue([A1, A2]);
  alertSettings.mockResolvedValue(SETTINGS);
  companies.mockResolvedValue([{ id: 1, name: "Stripe", monitored: true }]);
  saveAlertSettings.mockImplementation(async (s: object) => ({ ...SETTINGS, ...s }));
  readAlert.mockResolvedValue({ ...A1, read: true });
  readAllAlerts.mockResolvedValue({ updated: 1 });
  dismissAlert.mockResolvedValue(undefined);
  checkAlerts.mockResolvedValue({ created: 2, boards: 1, errors: 0 });
});

describe("Alerts page", () => {
  it("fixtures satisfy the API schemas", () => {
    AlertSchema.parse(A1);
    AlertSettingsSchema.parse(SETTINGS);
  });

  it("lists alerts with the reason, the matched role and the source apply link", async () => {
    renderWith(<AlertsPage />);
    const first = (await screen.findByRole("heading", { level: 2, name: "Software Development Engineer II" })).closest("li")!;
    expect(first).toHaveTextContent("Why this matched: It is a Software Engineer role");
    expect(first).toHaveTextContent("Matched your wanted role “SDE”");
    expect(first).toHaveTextContent("New");
    expect(first).toHaveTextContent("Same kind of role");
    expect(first.querySelector("a")).toHaveAttribute("href", "https://boards.example.com/stripe/1");
    const second = screen.getByRole("heading", { level: 2, name: "Customer Solutions Engineer" }).closest("li")!;
    expect(second).toHaveTextContent("Checked by AI");
    expect(second.querySelector("a")).toBeNull(); // no apply link in the source record, none invented
    expect(second).not.toHaveTextContent("New");
  });

  it("marks one as read, marks all, and dismisses", async () => {
    const user = userEvent.setup();
    renderWith(<AlertsPage />);
    await user.click(await screen.findByRole("button", { name: "Mark Software Development Engineer II as read" }));
    await waitFor(() => expect(readAlert).toHaveBeenCalledWith(1));
    await user.click(screen.getByRole("button", { name: "Mark all as read" }));
    await waitFor(() => expect(readAllAlerts).toHaveBeenCalled());
    await user.click(screen.getByRole("button", { name: "Dismiss Customer Solutions Engineer" }));
    await waitFor(() => expect(dismissAlert).toHaveBeenCalledWith(2));
  });

  it("checks now and reports what it found", async () => {
    const user = userEvent.setup();
    renderWith(<AlertsPage />);
    await user.click(await screen.findByRole("button", { name: "Check now" }));
    await waitFor(() => expect(checkAlerts).toHaveBeenCalled());
    expect(await screen.findByText("2 new roles found")).toBeInTheDocument();
  });

  it("saves delivery settings: email is opt-in and the frequency appears only when email is on", async () => {
    const user = userEvent.setup();
    renderWith(<AlertsPage />);
    const email = await screen.findByRole("switch", { name: /also email me/i });
    expect(email).not.toBeChecked();
    expect(screen.queryByLabelText(/how often/i)).not.toBeInTheDocument();
    await user.click(email);
    await waitFor(() => expect(saveAlertSettings).toHaveBeenCalledWith({ in_app: true, email: true, frequency: "daily" }));
    await user.selectOptions(await screen.findByLabelText(/how often/i), "weekly");
    await waitFor(() => expect(saveAlertSettings).toHaveBeenLastCalledWith({ in_app: true, email: true, frequency: "weekly" }));
    await user.click(screen.getByRole("switch", { name: /show alerts in nextrole/i }));
    await waitFor(() => expect(saveAlertSettings).toHaveBeenLastCalledWith({ in_app: false, email: true, frequency: "weekly" }));
  });

  it("says plainly when the server cannot send email", async () => {
    alertSettings.mockResolvedValue({ ...SETTINGS, email_available: false });
    renderWith(<AlertsPage />);
    expect(await screen.findByText(/Email is not set up on this server/)).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: /also email me/i })).not.toBeChecked();
  });

  it("explains each empty state", async () => {
    alerts.mockResolvedValue([]);
    companies.mockResolvedValue([]);
    const a = renderWith(<AlertsPage />);
    expect(await screen.findByText("Pick companies to watch")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Choose companies" })).toHaveAttribute("href", "/profile");
    expect(screen.getByRole("button", { name: "Check now" })).toBeDisabled();
    a.unmount();
    companies.mockResolvedValue([{ id: 2, name: "Tiny Co", monitored: false }]);
    renderWith(<AlertsPage />);
    expect(await screen.findByText(/None of the companies you watch have a job board we can read/)).toBeInTheDocument();
  });
});

describe("Unsubscribe page", () => {
  const open = (query: string) => window.history.pushState({}, "", `/unsubscribe${query}`);

  it("does nothing on load and unsubscribes only when the button is pressed", async () => {
    open("?token=1.abc");
    unsubscribeAlerts.mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderWith(<Unsubscribe />);
    expect(unsubscribeAlerts).not.toHaveBeenCalled(); // link scanners open links: no side effect on GET
    await user.click(screen.getByRole("button", { name: "Unsubscribe" }));
    await waitFor(() => expect(unsubscribeAlerts).toHaveBeenCalledWith("1.abc"));
    expect(await screen.findByRole("heading", { name: "You are unsubscribed" })).toBeInTheDocument();
  });

  it("shows a clear message for an invalid link and for a missing token", async () => {
    open("?token=bad");
    unsubscribeAlerts.mockRejectedValue(new ApiError("link not valid", 404));
    const user = userEvent.setup();
    const a = renderWith(<Unsubscribe />);
    await user.click(screen.getByRole("button", { name: "Unsubscribe" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/not valid any more/);
    a.unmount();
    open("");
    renderWith(<Unsubscribe />);
    expect(screen.getByRole("button", { name: "Unsubscribe" })).toBeDisabled();
    expect(screen.getByText(/link is incomplete/)).toBeInTheDocument();
  });
});
