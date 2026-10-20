import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const replace = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }));

const onboard = vi.fn();
const saveProfile = vi.fn();
vi.mock("@/lib/api/endpoints", () => ({ api: { onboard: (f: FormData) => onboard(f), saveProfile: (p: unknown) => saveProfile(p) } }));

import { ApiError } from "@/lib/api/client";
import type { Profile } from "@/lib/api/schemas";
import { OnboardingWizard } from "./wizard";

const PARSED: Profile = {
  name: "Priya Nair",
  summary: "Backend engineer.",
  skills: ["Python"],
  experience: [{ company: "Acme", title: "Engineer", start: "", end: "", bullets: [] }],
  projects: [],
  education: [],
  preferences: { roles: ["Backend Engineer"], locations: ["Bengaluru"], remote_ok: true, experience_level: "Mid", extras: "" },
};

function renderWizard() {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <OnboardingWizard />
    </QueryClientProvider>,
  );
}

async function toResumeStep(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("Roles"), "Backend Engineer{Enter}");
  await user.click(screen.getByRole("button", { name: /continue/i }));
  await user.click(await screen.findByRole("radio", { name: /Mid-level/ }));
  await user.type(screen.getByLabelText("Locations"), "Bengaluru{Enter}");
  await user.click(screen.getByRole("button", { name: /continue/i }));
}

beforeEach(() => vi.clearAllMocks());

describe("OnboardingWizard", () => {
  it("blocks step 1 until a role is added, and moves focus to each step heading", async () => {
    const user = userEvent.setup();
    renderWizard();
    await user.click(screen.getByRole("button", { name: /continue/i }));
    expect(screen.getByText(/add at least one role/i)).toBeInTheDocument();

    await user.type(screen.getByLabelText("Roles"), "Backend Engineer{Enter}");
    expect(screen.getByRole("button", { name: "Remove role Backend Engineer" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /continue/i }));
    expect(await screen.findByRole("heading", { name: /where, and at what level/i })).toHaveFocus();
  });

  it("requires an experience level on step 2", async () => {
    const user = userEvent.setup();
    renderWizard();
    await user.type(screen.getByLabelText("Roles"), "SWE{Enter}");
    await user.click(screen.getByRole("button", { name: /continue/i }));
    await user.click(await screen.findByRole("button", { name: /continue/i }));
    expect(screen.getByText(/pick the level/i)).toBeInTheDocument();
  });

  it("rejects an unsupported resume file before uploading", async () => {
    const user = userEvent.setup({ applyAccept: false });
    renderWizard();
    await toResumeStep(user);
    await user.upload(screen.getByLabelText(/drop your resume/i, { selector: "input" }), new File(["x"], "cv.txt", { type: "text/plain" }));
    await user.click(screen.getByRole("button", { name: /read my resume/i }));
    expect(screen.getByText(/PDF or DOCX/)).toBeInTheDocument();
    expect(onboard).not.toHaveBeenCalled();
  });

  it("sends everything in one multipart call, then lets the user review and save", async () => {
    onboard.mockResolvedValue(PARSED);
    saveProfile.mockImplementation(async (p) => p);
    const user = userEvent.setup();
    renderWizard();
    await toResumeStep(user);
    await user.upload(screen.getByLabelText(/drop your resume/i, { selector: "input" }), new File(["%PDF"], "cv.pdf", { type: "application/pdf" }));
    await user.click(screen.getByRole("button", { name: /read my resume/i }));

    const form = onboard.mock.calls[0][0] as FormData;
    expect(form.get("roles")).toBe("Backend Engineer");
    expect(form.get("locations")).toBe("Bengaluru");
    expect(form.get("experience_level")).toBe("Mid");

    expect(await screen.findByRole("heading", { name: /does this look right/i })).toHaveFocus();
    const name = screen.getByLabelText("Name");
    await user.clear(name);
    await user.type(name, "Priya N.");
    await user.click(screen.getByRole("button", { name: /show my jobs/i }));

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/dashboard"));
    expect(saveProfile).toHaveBeenCalledWith(expect.objectContaining({ name: "Priya N." }));
  });

  it("keeps the user on the resume step with the server's message when parsing fails", async () => {
    onboard.mockRejectedValue(new ApiError("could not read text from this PDF", 422));
    const user = userEvent.setup();
    renderWizard();
    await toResumeStep(user);
    await user.upload(screen.getByLabelText(/drop your resume/i, { selector: "input" }), new File(["%PDF"], "cv.pdf", { type: "application/pdf" }));
    await user.click(screen.getByRole("button", { name: /read my resume/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/could not read text/i);
    expect(screen.getByText("cv.pdf")).toBeInTheDocument(); // file kept, no need to re-pick
  });
});
