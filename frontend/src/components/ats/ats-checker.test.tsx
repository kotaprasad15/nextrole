import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const extract = vi.fn();
vi.mock("@/lib/ats/extract-text", async (orig) => ({ ...(await orig<typeof import("@/lib/ats/extract-text")>()), extractResumeText: (f: File) => extract(f) }));

import { joinPdfItems, validateAtsFile } from "@/lib/ats/extract-text";
import { SAMPLE_RESUME } from "@/lib/ats/sample";
import { AtsChecker } from "./ats-checker";

const fetchSpy = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", fetchSpy);
});

describe("AtsChecker", () => {
  it("asks for both inputs before analysing", async () => {
    const user = userEvent.setup();
    render(<AtsChecker />);
    await user.click(screen.getByRole("button", { name: /check my resume/i }));
    expect(screen.getByText(/add your resume/i)).toBeInTheDocument();
    expect(screen.getByText(/paste the job description/i)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /match|needs work/i })).not.toBeInTheDocument();
  });

  it("analyses the sample, focuses the result, and shows matched and missing keywords", async () => {
    const user = userEvent.setup();
    render(<AtsChecker />);
    await user.click(screen.getByRole("button", { name: /sample data/i }));
    await user.click(screen.getByRole("button", { name: /check my resume/i }));
    const heading = await screen.findByRole("heading", { level: 2, name: /match|needs work/i });
    expect(heading).toHaveFocus();
    const matched = screen.getByText(/In your resume \(/).closest("div")!;
    expect(within(matched).getByText("Python")).toBeInTheDocument();
    expect(within(matched).getByText("FastAPI")).toBeInTheDocument();
    const missing = screen.getByText(/Missing, preferred/).closest("div")!;
    expect(within(missing).getByText(/Kubernetes/)).toBeInTheDocument();
    expect(screen.getByText(/never uploaded/i)).toBeInTheDocument();
    expect(screen.getByText(/only add skills you really have/i)).toBeInTheDocument();
  });

  it("puts text extracted from a file into the editable box", async () => {
    extract.mockResolvedValue(SAMPLE_RESUME);
    const user = userEvent.setup({ applyAccept: false });
    render(<AtsChecker />);
    await user.upload(screen.getByLabelText(/drop your resume/i, { selector: "input" }), new File(["x"], "cv.pdf", { type: "application/pdf" }));
    await waitFor(() => expect(screen.getByLabelText("Resume text")).toHaveValue(SAMPLE_RESUME));
    expect(screen.getByText("cv.pdf")).toBeInTheDocument();
  });

  it("shows a friendly message when a file cannot be read, and rejects the wrong type", async () => {
    extract.mockRejectedValue(new Error("We could not read text from that file."));
    const user = userEvent.setup({ applyAccept: false });
    render(<AtsChecker />);
    const input = screen.getByLabelText(/drop your resume/i, { selector: "input" });
    await user.upload(input, new File(["x"], "scan.pdf", { type: "application/pdf" }));
    expect(await screen.findByText(/could not read text/i)).toBeInTheDocument();
    await user.upload(screen.getByLabelText(/drop your resume/i, { selector: "input" }), new File(["x"], "cv.exe"));
    expect(await screen.findByText(/PDF, DOCX or TXT/i)).toBeInTheDocument();
  });

  it("never sends anything over the network", async () => {
    const user = userEvent.setup();
    render(<AtsChecker />);
    await user.click(screen.getByRole("button", { name: /sample data/i }));
    await user.click(screen.getByRole("button", { name: /check my resume/i }));
    await screen.findByRole("heading", { level: 2, name: /match|needs work/i });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("file helpers", () => {
  it("validates type and size", () => {
    expect(validateAtsFile({ name: "a.docx", size: 10 })).toBeUndefined();
    expect(validateAtsFile({ name: "a.TXT", size: 10 })).toBeUndefined();
    expect(validateAtsFile({ name: "a.doc", size: 10 })).toMatch(/PDF, DOCX or TXT/);
    expect(validateAtsFile({ name: "a.pdf", size: 0 })).toMatch(/empty/);
    expect(validateAtsFile({ name: "a.pdf", size: 6 * 1024 * 1024 })).toMatch(/5 MB/);
  });
  it("rebuilds lines from PDF text items by baseline", () => {
    const items = [
      { str: "Priya", transform: [1, 0, 0, 1, 10, 700] },
      { str: "Nair", transform: [1, 0, 0, 1, 50, 700] },
      { str: "priya@example.com", transform: [1, 0, 0, 1, 10, 680] },
      { str: "Experience", transform: [1, 0, 0, 1, 10, 650], hasEOL: true },
      { str: "Built APIs", transform: [1, 0, 0, 1, 10, 630] },
    ];
    expect(joinPdfItems(items)).toBe("Priya Nair\npriya@example.com\nExperience\nBuilt APIs");
  });
});
