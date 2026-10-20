import { detectSections, formatIssues, SEVERITY_PENALTY, type Issue, type SectionStatus } from "./checks";
import { IMPORTANCE_WEIGHT, extractKeywords, isKnownSkill, resumeTerms, type Importance, type Keyword } from "./keywords";

/**
 * Deterministic, in-browser resume check against a job description. This is a HEURISTIC
 * estimate (keyword coverage, structure, formatting), not the score of any real ATS, and the
 * resume never leaves the browser. Every number below is explained in the UI.
 */
export interface KeywordResult extends Keyword {
  found: boolean;
}

export interface Suggestion {
  section: "Skills" | "Experience" | "Summary" | "Contact" | "Education" | "Formatting";
  tips: string[];
}

export interface AtsResult {
  score: number;
  /** Each part is 0 to 100 and is weighted 60 / 20 / 20 into `score`. */
  breakdown: { keywords: number; sections: number; formatting: number };
  keywords: KeywordResult[];
  matched: KeywordResult[];
  missing: KeywordResult[];
  sections: SectionStatus[];
  issues: Issue[];
  suggestions: Suggestion[];
  /** Estimated score if the missing required and preferred keywords were added (truthfully). */
  projectedScore: number;
  wordCount: number;
  /** True when the posting gave us nothing to match (too short, or no recognisable terms). */
  noKeywords: boolean;
}

export const WEIGHTS = { keywords: 0.6, sections: 0.2, formatting: 0.2 } as const;
const SECTION_POINTS: Record<string, number> = { contact: 15, experience: 30, education: 20, skills: 25, summary: 5, projects: 5 };

const pct = (n: number, d: number) => (d === 0 ? 0 : (n / d) * 100);
const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

function keywordScore(list: { importance: Importance; found: boolean }[]): number {
  const total = list.reduce((s, k) => s + IMPORTANCE_WEIGHT[k.importance], 0);
  const got = list.filter((k) => k.found).reduce((s, k) => s + IMPORTANCE_WEIGHT[k.importance], 0);
  return pct(got, total);
}

export function analyze(resume: string, jobDescription: string): AtsResult {
  const have = resumeTerms(resume);
  const keywords: KeywordResult[] = extractKeywords(jobDescription).map((k) => ({ ...k, found: have.has(k.term) }));
  const matched = keywords.filter((k) => k.found);
  const missing = keywords.filter((k) => !k.found);

  const sections = detectSections(resume);
  const sectionScore = sections.filter((s) => s.found).reduce((s, x) => s + SECTION_POINTS[x.id], 0);
  const issues = formatIssues(resume);
  const formatScore = clamp(100 - issues.reduce((s, i) => s + SEVERITY_PENALTY[i.severity], 0));

  const kw = keywordScore(keywords);
  const total = (k: number) => clamp(WEIGHTS.keywords * k + WEIGHTS.sections * sectionScore + WEIGHTS.formatting * formatScore);
  const projectedKw = keywordScore(keywords.map((k) => ({ ...k, found: k.found || k.importance !== "general" })));

  return {
    score: total(kw),
    breakdown: { keywords: clamp(kw), sections: clamp(sectionScore), formatting: formatScore },
    keywords,
    matched,
    missing,
    sections,
    issues,
    suggestions: suggest(missing, sections, issues),
    projectedScore: Math.max(total(kw), total(projectedKw)),
    wordCount: resume.trim() ? resume.trim().split(/\s+/).length : 0,
    noKeywords: keywords.length === 0,
  };
}

const list = (ks: KeywordResult[], n = 8) => ks.slice(0, n).map((k) => k.display).join(", ");

function suggest(missing: KeywordResult[], sections: SectionStatus[], issues: Issue[]): Suggestion[] {
  const out: Suggestion[] = [];
  const has = (id: string) => sections.find((s) => s.id === id)?.found;
  const priority = missing.filter((k) => k.importance !== "general");
  const skills = priority.filter((k) => isKnownSkill(k.term));
  const wording = missing.filter((k) => !isKnownSkill(k.term) && k.importance !== "general");

  if (!has("skills")) out.push({ section: "Skills", tips: ["Add a Skills section with a simple comma-separated list of tools and technologies you have actually used."] });
  if (skills.length) out.push({ section: "Skills", tips: [`The posting asks for ${list(skills)}. Add each one you genuinely have to your Skills section.`] });

  const exp: string[] = [];
  if (!has("experience")) exp.push("Add an Experience section with your roles, employers and dates.");
  if (wording.length) exp.push(`The posting repeats ${list(wording, 6)}. Where it is true, use the same words in your bullets so a parser can connect them.`);
  if (skills.length) exp.push(`Show ${list(skills, 3)} in action: name the tool inside a bullet that states what you built and the result.`);
  if (exp.length) out.push({ section: "Experience", tips: exp });

  if (!has("summary")) out.push({ section: "Summary", tips: ["Add a two-line summary at the top that names the role you want and your three strongest matching skills."] });
  else if (priority.length) out.push({ section: "Summary", tips: [`Mention your most relevant match for this role near the top. Missing so far: ${list(priority, 3)}.`] });

  if (!has("contact")) out.push({ section: "Contact", tips: ["Put your email and phone at the top as plain text."] });
  if (!has("education")) out.push({ section: "Education", tips: ["Add an Education section, even if short (degree, institution, year)."] });

  const fix = issues.filter((i) => i.severity !== "low");
  if (fix.length) out.push({ section: "Formatting", tips: fix.map((i) => i.fix) });
  return out;
}
