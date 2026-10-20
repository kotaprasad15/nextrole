import { beforeEach, describe, expect, it } from "vitest";
import type { CriticReport } from "@/lib/api/schemas";
import { diffLines } from "./diff";
import { clearVersions, MAX_VERSIONS, recordVersion, versionsFor } from "./local/draft-versions";
import { copyText, criterionLabel, gmailComposeUrl, mailtoUrl, safeSource, unverified, wordCount } from "./outreach";

const report = (o: Partial<CriticReport> = {}): CriticReport => ({
  scores: {}, overall: 90, unsupported_claims: [], violations: [], verdict: "pass", rewrite_instructions: "", ...o,
});

describe("outreach helpers", () => {
  it("counts words", () => {
    expect(wordCount("")).toBe(0);
    expect(wordCount("  one two\nthree ")).toBe(3);
  });
  it("copies the subject only for email", () => {
    expect(copyText("email", "Hi", "Body")).toBe("Subject: Hi\n\nBody");
    expect(copyText("message", "Hi", "Body")).toBe("Body");
  });
  it("builds a mailto link only for a valid address, encoding subject and body", () => {
    expect(mailtoUrl("not-an-email", "s", "b")).toBeNull();
    expect(mailtoUrl(" talent@acme.com ", "A & B", "line1\nline2")).toBe("mailto:talent@acme.com?subject=A%20%26%20B&body=line1%0Aline2");
  });
  it("builds a Gmail compose link", () => {
    const u = new URL(gmailComposeUrl("a@b.co", "Hello there", "Body"));
    expect(u.origin + u.pathname).toBe("https://mail.google.com/mail/");
    expect(u.searchParams.get("to")).toBe("a@b.co");
    expect(u.searchParams.get("su")).toBe("Hello there");
  });
  it("flags drafts the reviewer has not vouched for", () => {
    expect(unverified({ critic: null })).toBe(true);
    expect(unverified({ critic: report({ verdict: "revise" }) })).toBe(true);
    expect(unverified({ critic: report({ unsupported_claims: ["x"] }) })).toBe(true);
    expect(unverified({ critic: report() })).toBe(false);
  });
  it("labels criteria and only trusts https sources", () => {
    expect(criterionLabel("no_fluff")).toBe("No filler");
    expect(criterionLabel("some_new_key")).toBe("Some new key");
    expect(safeSource("https://x.com/a")).toBe("https://x.com/a");
    expect(safeSource("javascript:alert(1)")).toBeNull();
    expect(safeSource("http://x.com")).toBeNull();
    expect(safeSource(null)).toBeNull();
  });
});

describe("diffLines", () => {
  it("marks added, removed and unchanged lines", () => {
    expect(diffLines("a\nb\nc", "a\nx\nc")).toEqual([
      { kind: "same", text: "a" },
      { kind: "del", text: "b" },
      { kind: "add", text: "x" },
      { kind: "same", text: "c" },
    ]);
  });
  it("handles identical and empty inputs", () => {
    expect(diffLines("a", "a").every((l) => l.kind === "same")).toBe(true);
    expect(diffLines("", "a").map((l) => l.kind)).toEqual(["del", "add"]);
  });
});

describe("draft version history", () => {
  beforeEach(() => localStorage.clear());
  const v = (body: string) => ({ subject: "S", body, source: "generated" as const, score: 90 });

  it("records a snapshot only when the content changed, newest first", () => {
    expect(recordVersion("j1", v("one"))).toBe(true);
    expect(recordVersion("j1", v("one"))).toBe(false);
    expect(recordVersion("j1", v("two"))).toBe(true);
    expect(versionsFor("j1").map((x) => x.body)).toEqual(["two", "one"]);
    expect(versionsFor("other")).toEqual([]);
  });
  it("caps the history per job and can clear it", () => {
    for (let i = 0; i < MAX_VERSIONS + 5; i++) recordVersion("j1", v(`b${i}`));
    expect(versionsFor("j1")).toHaveLength(MAX_VERSIONS);
    expect(versionsFor("j1")[0].body).toBe(`b${MAX_VERSIONS + 4}`);
    clearVersions("j1");
    expect(versionsFor("j1")).toEqual([]);
  });
  it("survives corrupt storage", () => {
    localStorage.setItem("nextrole_draft_versions", "{oops");
    expect(versionsFor("j1")).toEqual([]);
    expect(recordVersion("j1", v("x"))).toBe(true);
  });
});
