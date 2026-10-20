/** Structure and formatting checks on the resume's plain text. Each returns issues with a concrete fix. */

export type SectionId = "contact" | "summary" | "experience" | "education" | "skills" | "projects";

export interface SectionStatus {
  id: SectionId;
  label: string;
  found: boolean;
  /** Counts toward the score (summary and projects are optional). */
  required: boolean;
}

export interface Issue {
  id: string;
  severity: "high" | "medium" | "low";
  title: string;
  detail: string;
  fix: string;
}

const HEADINGS: Record<Exclude<SectionId, "contact">, RegExp> = {
  summary: /^(?:professional\s+|career\s+)?(?:summary|profile|objective|about(?:\s+me)?)$/i,
  experience: /^(?:work\s+|professional\s+|relevant\s+|industry\s+)?(?:experience|employment(?:\s+history)?|work\s+history)$/i,
  education: /^(?:education|academic(?:\s+background)?|qualifications)$/i,
  skills: /^(?:(?:technical|key|core)\s+)?(?:skills|technologies|competencies|tech\s+stack)$/i,
  projects: /^(?:(?:personal|selected|side|academic)\s+)?projects?$/i,
};

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const PHONE = /(?:\+?\d{1,3}[\s.-]?)?(?:\(\d{2,4}\)|\d{2,4})[\s.-]?\d{3,4}[\s.-]?\d{3,4}/;

const lines = (text: string) => text.split(/\r?\n/);
const words = (text: string) => (text.trim() ? text.trim().split(/\s+/) : []);
const isHeading = (line: string) => {
  const s = line.trim().replace(/[:\s]+$/, "");
  return s.length > 0 && s.length <= 40;
};

export function detectSections(text: string): SectionStatus[] {
  const found = new Set<SectionId>();
  for (const l of lines(text)) {
    if (!isHeading(l)) continue;
    const s = l.trim().replace(/[:\s]+$/, "");
    for (const [id, re] of Object.entries(HEADINGS) as [Exclude<SectionId, "contact">, RegExp][]) if (re.test(s)) found.add(id);
  }
  if (EMAIL.test(text) || PHONE.test(text)) found.add("contact");
  const all: [SectionId, string, boolean][] = [
    ["contact", "Contact details", true],
    ["summary", "Summary", false],
    ["experience", "Experience", true],
    ["education", "Education", true],
    ["skills", "Skills", true],
    ["projects", "Projects", false],
  ];
  return all.map(([id, label, required]) => ({ id, label, found: found.has(id), required }));
}

const BULLET = /^\s*(?:[•·●▪‣◦*-]|\d+[.)])\s+\S/;
const MONTHS = /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+(?:19|20)\d{2}\b/i;
const YEARS = /\b(?:19|20)\d{2}\b/;
const FANCY = /[★☆✓✔✗✘→►▶◆■□❖☎✉☑]/g;

export function formatIssues(text: string): Issue[] {
  const out: Issue[] = [];
  const ls = lines(text).filter((l) => l.trim());
  const n = words(text).length;

  if (!EMAIL.test(text)) {
    out.push({ id: "no-email", severity: "high", title: "No email address found", detail: "Recruiters and ATS parsers look for contact details at the top.", fix: "Add a plain-text email address near the top, not inside an image or header graphic." });
  }
  if (!PHONE.test(text)) {
    out.push({ id: "no-phone", severity: "low", title: "No phone number found", detail: "Some recruiters prefer to call.", fix: "Add a phone number with country code, for example +44 7700 900123." });
  }
  if (n < 250) {
    out.push({ id: "too-short", severity: "medium", title: `Only ${n} words`, detail: "Very short resumes give an ATS little to match against.", fix: "Describe each role with 3 to 5 bullets covering what you built, with which tools, and the result." });
  } else if (n > 1000) {
    out.push({ id: "too-long", severity: "medium", title: `${n} words is long`, detail: "Long resumes dilute the keywords that matter and are rarely read in full.", fix: "Cut to the most relevant 1 to 2 pages: drop older or unrelated roles and trim duplicated bullets." });
  }

  const bullets = ls.filter((l) => BULLET.test(l));
  if (n >= 150 && bullets.length < 3) {
    out.push({ id: "no-bullets", severity: "medium", title: "Few or no bullet points", detail: "Dense paragraphs are hard for both parsers and people to scan.", fix: "Turn each role into short bullets that start with a verb (Built, Reduced, Led)." });
  }
  if (bullets.length >= 3) {
    const withNumbers = bullets.filter((l) => /\d/.test(l)).length;
    if (withNumbers / bullets.length < 0.2) {
      out.push({ id: "no-metrics", severity: "medium", title: "Few numbers in your bullets", detail: `Only ${withNumbers} of ${bullets.length} bullets include a figure.`, fix: "Add scale and results where true: users, latency, cost saved, tests written, team size." });
    }
  }

  const columnish = ls.filter((l) => /\t/.test(l) || (l.match(/\S {3,}\S/g) ?? []).length >= 2).length;
  if (ls.length >= 10 && columnish / ls.length > 0.15) {
    out.push({ id: "columns", severity: "high", title: "Looks like columns or a table", detail: "Text laid out in columns or tables is often read out of order by an ATS.", fix: "Use a single-column layout. Keep skills as a simple comma-separated line or list." });
  }
  const fancy = text.match(FANCY)?.length ?? 0;
  if (fancy > 4) {
    out.push({ id: "symbols", severity: "low", title: "Decorative symbols", detail: `${fancy} icons or special symbols may not survive parsing.`, fix: "Use plain bullets and write labels as text (Email: ..., not an envelope icon)." });
  }
  if (n >= 150 && !YEARS.test(text) && !MONTHS.test(text)) {
    out.push({ id: "no-dates", severity: "high", title: "No dates found", detail: "An ATS builds your timeline from dates; without them roles can be dropped.", fix: "Put a clear date range on every role, for example Jan 2023 - Present." });
  }
  const firstPerson = (text.match(/\b(?:I|my|me)\b/g) ?? []).length;
  if (firstPerson > 5) {
    out.push({ id: "first-person", severity: "low", title: "First-person phrasing", detail: `"I", "my" or "me" appears ${firstPerson} times.`, fix: "Start bullets with a verb and drop the pronoun: \"Built an API...\" instead of \"I built an API...\"." });
  }
  const avg = ls.length ? ls.reduce((s, l) => s + l.length, 0) / ls.length : 0;
  if (n >= 150 && avg > 150) {
    out.push({ id: "long-lines", severity: "low", title: "Very long lines", detail: "Paragraph-style text is harder to scan.", fix: "Break long sentences into separate bullets of one idea each." });
  }
  return out;
}

export const SEVERITY_PENALTY = { high: 18, medium: 10, low: 4 } as const;
