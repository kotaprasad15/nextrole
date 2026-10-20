import { describe, expect, it } from "vitest";
import { analyze, WEIGHTS } from "./analyze";
import { detectSections, formatIssues } from "./checks";
import { extractKeywords, normalize, resumeTerms, tokens } from "./keywords";

const JD = `Backend Engineer, Platform

About the role
We build the APIs behind our customer dashboard. You will design and operate services in Python.

Requirements:
- 3+ years of experience with Python and FastAPI
- Strong PostgreSQL and SQL skills
- Experience with Docker and CI/CD pipelines

Nice to have:
- Kubernetes
- Terraform
`;

const GOOD_RESUME = `Priya Nair
priya@example.com | +44 7700 900123

Summary
Backend engineer who builds REST APIs with FastAPI and PostgreSQL.

Experience
Software Engineer, Finlytics  Jan 2023 - Present
- Built REST APIs in Python and FastAPI serving 40k requests per day
- Wrote PostgreSQL queries and SQL migrations, cutting report time by 35%
- Containerised services with Docker and set up CI/CD in GitHub Actions
- Reviewed 120+ pull requests and mentored 2 interns

Education
BSc Computer Science, University of Leeds, 2022

Skills
Python, FastAPI, PostgreSQL, SQL, Docker, CI/CD, Git, React
`.repeat(1) + "\nProjects\n- Expense sharing app with FastAPI and React used by 200 students\n" + "Worked with a distributed team on delivery and testing practices. ".repeat(18);

const BAD_RESUME = `I am a hard worker. I like computers.   I did my homework.\nMy goal is my growth.`;

describe("normalize and tokens", () => {
  it("canonicalises aliases and punctuation", () => {
    expect(normalize("Node.js, k8s & CI/CD; C++ and C#")).toBe("node kubernetes cicd cpp and csharp");
    expect(normalize("PostgreSQL / Postgres")).toBe("postgresql postgresql");
    expect(tokens("REST APIs and databases")).toEqual(["rest", "api", "and", "database"]);
    expect(resumeTerms("RESTful APIs").has("rest api")).toBe(true);
  });
  it("makes plural and singular match", () => {
    expect(resumeTerms("built several APIs").has("api")).toBe(true);
  });
});

describe("extractKeywords", () => {
  const kws = extractKeywords(JD);
  const get = (t: string) => kws.find((k) => k.term === t);

  it("finds known skills with readable names", () => {
    expect(get("python")?.display).toBe("Python");
    expect(get("fastapi")?.display).toBe("FastAPI");
    expect(get("cicd")?.display).toBe("CI/CD");
    expect(get("postgresql")?.display).toBe("PostgreSQL");
  });
  it("marks importance from headings", () => {
    expect(get("fastapi")?.importance).toBe("required");
    expect(get("docker")?.importance).toBe("required");
    expect(get("kubernetes")?.importance).toBe("preferred");
    expect(get("terraform")?.importance).toBe("preferred");
  });
  it("ignores boilerplate and one-off filler words", () => {
    const terms = kws.map((k) => k.term);
    for (const bad of ["role", "will", "strong", "experience", "about", "years"]) expect(terms).not.toContain(bad);
  });
  it("returns nothing useful for an empty posting", () => {
    expect(extractKeywords("")).toEqual([]);
  });
  it("is deterministic", () => {
    expect(extractKeywords(JD)).toEqual(extractKeywords(JD));
  });
});

describe("section and format checks", () => {
  it("detects sections from headings and contact details", () => {
    const s = Object.fromEntries(detectSections(GOOD_RESUME).map((x) => [x.id, x.found]));
    expect(s).toEqual({ contact: true, summary: true, experience: true, education: true, skills: true, projects: true });
    const bad = Object.fromEntries(detectSections(BAD_RESUME).map((x) => [x.id, x.found]));
    expect(bad.experience).toBe(false);
    expect(bad.contact).toBe(false);
  });
  it("flags a missing email, no dates and first-person text", () => {
    const text = "I built things. I led my team. I like my work. I wrote my plans. I did my best. I made me proud. ".repeat(12);
    const ids = formatIssues(text).map((i) => i.id);
    expect(ids).toEqual(expect.arrayContaining(["no-email", "no-dates", "first-person"]));
  });
  it("flags column-style layouts", () => {
    const row = "Python      SQL      Docker      Linux\n";
    expect(formatIssues(`a@b.co\n2023\n` + row.repeat(12)).map((i) => i.id)).toContain("columns");
  });
  it("is quiet on a clean resume", () => {
    const ids = formatIssues(GOOD_RESUME).filter((i) => i.severity !== "low").map((i) => i.id);
    expect(ids).toEqual([]);
  });
});

describe("analyze", () => {
  it("scores a matching resume high and lists what matched", () => {
    const r = analyze(GOOD_RESUME, JD);
    expect(r.score).toBeGreaterThanOrEqual(80);
    expect(r.matched.map((k) => k.term)).toEqual(expect.arrayContaining(["python", "fastapi", "postgresql", "docker", "cicd"]));
    expect(r.missing.map((k) => k.term)).toEqual(expect.arrayContaining(["kubernetes", "terraform"]));
  });
  it("scores an unrelated resume low", () => {
    const r = analyze(BAD_RESUME, JD);
    expect(r.score).toBeLessThan(35);
    expect(r.matched).toHaveLength(0);
  });
  it("combines the three parts with the documented weights", () => {
    const r = analyze(GOOD_RESUME, JD);
    const expected = Math.round(WEIGHTS.keywords * r.breakdown.keywords + WEIGHTS.sections * r.breakdown.sections + WEIGHTS.formatting * r.breakdown.formatting);
    expect(Math.abs(r.score - expected)).toBeLessThanOrEqual(1);
  });
  it("projects a higher score when missing required/preferred keywords are added, never lower", () => {
    const r = analyze(GOOD_RESUME, JD);
    expect(r.projectedScore).toBeGreaterThan(r.score);
    const full = analyze(`${GOOD_RESUME}\nKubernetes Terraform`, JD);
    expect(full.projectedScore).toBeGreaterThanOrEqual(full.score);
  });
  it("adding a missing keyword to the resume raises the score", () => {
    const before = analyze(GOOD_RESUME, JD);
    const after = analyze(`${GOOD_RESUME}\nSkills: Kubernetes, Terraform`, JD);
    expect(after.score).toBeGreaterThan(before.score);
    expect(after.missing.map((k) => k.term)).not.toContain("kubernetes");
  });
  it("gives section-specific suggestions that only ask for truthful additions", () => {
    const r = analyze(GOOD_RESUME, JD);
    const skills = r.suggestions.find((s) => s.section === "Skills");
    expect(skills?.tips.join(" ")).toMatch(/Kubernetes/);
    expect(skills?.tips.join(" ")).toMatch(/genuinely have|actually used/);
  });
  it("reports when the posting has nothing to match", () => {
    const r = analyze(GOOD_RESUME, "Join us.");
    expect(r.noKeywords).toBe(true);
    expect(r.breakdown.keywords).toBe(0);
  });
  it("keeps every number in range", () => {
    for (const r of [analyze(GOOD_RESUME, JD), analyze(BAD_RESUME, JD), analyze("", JD)]) {
      for (const n of [r.score, r.projectedScore, ...Object.values(r.breakdown)]) {
        expect(n).toBeGreaterThanOrEqual(0);
        expect(n).toBeLessThanOrEqual(100);
      }
    }
  });
});
