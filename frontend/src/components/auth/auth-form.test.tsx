import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const replace = vi.fn();
let search = "";
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
  useSearchParams: () => new URLSearchParams(search),
}));

const login = vi.fn();
const signup = vi.fn();
const profile = vi.fn();
vi.mock("@/lib/api/endpoints", () => ({ api: { login: (...a: unknown[]) => login(...a), signup: (...a: unknown[]) => signup(...a), profile: () => profile() } }));

import { ApiError } from "@/lib/api/client";
import { AuthForm } from "./auth-form";

function renderForm(mode: "login" | "signup") {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <AuthForm mode={mode} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  search = "";
  window.history.pushState({}, "", "/");
});

describe("AuthForm", () => {
  it("validates before submitting and focuses the first invalid field", async () => {
    const user = userEvent.setup();
    renderForm("signup");
    await user.click(screen.getByRole("button", { name: "Create account" }));
    expect(screen.getByText(/enter your email address/i)).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toHaveFocus();
    expect(screen.getByLabelText("Email")).toHaveAttribute("aria-invalid", "true");
    expect(signup).not.toHaveBeenCalled();
  });

  it("flags a weak password on signup and names what is missing", async () => {
    const user = userEvent.setup();
    renderForm("signup");
    await user.type(screen.getByLabelText("Email"), "a@b.co");
    await user.type(screen.getByLabelText("Password"), "short");
    await user.click(screen.getByRole("button", { name: "Create account" }));
    expect(screen.getByText(/still needs: at least 8 characters/i, { selector: "p[role=alert]" })).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toHaveFocus();
    expect(signup).not.toHaveBeenCalled();
  });

  it("shows a live checklist that ticks off each rule as the password is typed", async () => {
    const user = userEvent.setup();
    renderForm("signup");
    const list = screen.getByRole("list", { name: /password requirements/i });
    const met = () => Array.from(list.querySelectorAll("li")).filter((li) => li.getAttribute("data-met") === "true").length;
    expect(met()).toBe(0);
    await user.type(screen.getByLabelText("Password"), "abcdefgh");
    expect(met()).toBe(2); // length + lowercase
    await user.type(screen.getByLabelText("Password"), "A");
    expect(met()).toBe(3);
    await user.type(screen.getByLabelText("Password"), "!");
    expect(met()).toBe(4);
    expect(list).toHaveTextContent(/one special character.*met/i);
  });

  it("requires the confirmation to match and focuses it", async () => {
    const user = userEvent.setup();
    renderForm("signup");
    await user.type(screen.getByLabelText("Email"), "a@b.co");
    await user.type(screen.getByLabelText("Password"), "Longenough1!");
    await user.type(screen.getByLabelText("Confirm password"), "Longenough1?");
    await user.click(screen.getByRole("button", { name: "Create account" }));
    expect(screen.getByText(/do not match/i, { selector: "p[role=alert]" })).toBeInTheDocument();
    expect(screen.getByLabelText("Confirm password")).toHaveFocus();
    expect(signup).not.toHaveBeenCalled();
  });

  it("has no confirm field when logging in", () => {
    renderForm("login");
    expect(screen.queryByLabelText("Confirm password")).not.toBeInTheDocument();
    expect(screen.queryByRole("list", { name: /password requirements/i })).not.toBeInTheDocument();
  });

  it("sends new accounts to onboarding", async () => {
    signup.mockResolvedValue({ email: "a@b.co" });
    const user = userEvent.setup();
    renderForm("signup");
    await user.type(screen.getByLabelText("Email"), "a@b.co");
    await user.type(screen.getByLabelText("Password"), "Longenough1!");
    await user.type(screen.getByLabelText("Confirm password"), "Longenough1!");
    await user.click(screen.getByRole("button", { name: "Create account" }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/onboarding"));
    expect(signup).toHaveBeenCalledWith("a@b.co", "Longenough1!", "Longenough1!");
  });

  it("shows 'already exists' on the email field", async () => {
    signup.mockRejectedValue(new ApiError("email already registered", 409));
    const user = userEvent.setup();
    renderForm("signup");
    await user.type(screen.getByLabelText("Email"), "taken@example.com");
    await user.type(screen.getByLabelText("Password"), "Longenough1!");
    await user.type(screen.getByLabelText("Confirm password"), "Longenough1!");
    await user.click(screen.getByRole("button", { name: "Create account" }));
    expect(await screen.findByText(/already exists/i)).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toHaveFocus();
  });

  it("shows a form-level error on a wrong password, never naming which half was wrong", async () => {
    login.mockRejectedValue(new ApiError("invalid email or password", 401));
    const user = userEvent.setup();
    renderForm("login");
    await user.type(screen.getByLabelText("Email"), "a@b.co");
    await user.type(screen.getByLabelText("Password"), "wrong-password");
    await user.click(screen.getByRole("button", { name: "Log in" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/don't match/i);
    expect(screen.getByLabelText("Email")).not.toHaveAttribute("aria-invalid");
  });

  it("logs a returning user in to where they were headed", async () => {
    window.history.pushState({}, "", "/login?next=%2Foutreach"); // read at submit time, not render time
    login.mockResolvedValue({ email: "a@b.co" });
    profile.mockResolvedValue({});
    const user = userEvent.setup();
    renderForm("login");
    await user.type(screen.getByLabelText("Email"), "a@b.co");
    await user.type(screen.getByLabelText("Password"), "longenough1");
    await user.click(screen.getByRole("button", { name: "Log in" }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/outreach"));
  });

  it("sends a returning user who never finished onboarding to onboarding", async () => {
    login.mockResolvedValue({ email: "a@b.co" });
    profile.mockRejectedValue(new ApiError("no profile yet", 404));
    const user = userEvent.setup();
    renderForm("login");
    await user.type(screen.getByLabelText("Email"), "a@b.co");
    await user.type(screen.getByLabelText("Password"), "longenough1");
    await user.click(screen.getByRole("button", { name: "Log in" }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/onboarding"));
  });

  it("toggles password visibility", async () => {
    const user = userEvent.setup();
    renderForm("login");
    const input = screen.getByLabelText("Password");
    expect(input).toHaveAttribute("type", "password");
    await user.click(screen.getByRole("button", { name: "Show password" }));
    expect(input).toHaveAttribute("type", "text");
  });
});
