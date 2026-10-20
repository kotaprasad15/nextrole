import { describe, expect, it } from "vitest";
import { EMPTY_WIZARD, buildOnboardingForm, validateReview, validateStep } from "./onboarding";
import { MAX_RESUME_BYTES, validateResume } from "./resume-file";
import { addTags, splitTags } from "./tags";
import type { Profile } from "./api/schemas";

describe("tags", () => {
  it("splits on commas and newlines and trims", () => {
    expect(splitTags(" a, b ,\n c,, ")).toEqual(["a", "b", "c"]);
  });
  it("dedupes case-insensitively and respects max", () => {
    expect(addTags(["Python"], ["python", "Go", "Rust"], 2)).toEqual(["Python", "Go"]);
  });
});

describe("validateResume", () => {
  it("accepts pdf and docx", () => {
    expect(validateResume({ name: "CV.PDF", size: 10 })).toBeUndefined();
    expect(validateResume({ name: "cv.docx", size: 10 })).toBeUndefined();
  });
  it("rejects other types, empty and oversized files", () => {
    expect(validateResume({ name: "cv.doc", size: 10 })).toMatch(/PDF or DOCX/);
    expect(validateResume({ name: "cv.pdf", size: 0 })).toMatch(/empty/);
    expect(validateResume({ name: "cv.pdf", size: MAX_RESUME_BYTES + 1 })).toMatch(/5 MB/);
  });
});

describe("wizard validation", () => {
  it("needs at least one role", () => {
    expect(validateStep("roles", EMPTY_WIZARD).roles).toMatch(/at least one role/i);
    expect(validateStep("roles", { ...EMPTY_WIZARD, roles: ["SWE"] })).toEqual({});
  });
  it("needs a level, and a location unless remote is allowed", () => {
    const w = { ...EMPTY_WIZARD, remote_ok: false };
    const errs = validateStep("where", w);
    expect(errs.locations).toMatch(/location/i);
    expect(errs.experience_level).toBeTruthy();
    expect(validateStep("where", { ...EMPTY_WIZARD, remote_ok: true, experience_level: "Mid" })).toEqual({});
  });
  it("builds the multipart body the backend expects", () => {
    const resume = new File(["x"], "cv.pdf", { type: "application/pdf" });
    const form = buildOnboardingForm({ ...EMPTY_WIZARD, roles: ["A", "B"], locations: ["X"], experience_level: "Mid", extras: " hi ", resume });
    expect(form.get("roles")).toBe("A, B");
    expect(form.get("locations")).toBe("X");
    expect(form.get("remote_ok")).toBe("true");
    expect(form.get("extras")).toBe("hi");
    expect((form.get("resume") as File).name).toBe("cv.pdf");
    expect(() => buildOnboardingForm(EMPTY_WIZARD)).toThrow();
  });
  it("review requires a name", () => {
    const p = { name: " ", summary: "", skills: [] } as unknown as Profile;
    expect(validateReview(p).name).toMatch(/name/i);
  });
});
