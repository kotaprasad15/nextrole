import { ALIASES, PREFERRED_CUES, PREFERRED_HEADINGS, REQUIRED_CUES, REQUIRED_HEADINGS, SKILLS, STOP_WORDS } from "./dictionary";

export type Importance = "required" | "preferred" | "general";

export interface Keyword {
  /** Canonical form used for matching. */
  term: string;
  /** Readable form shown to the user (as written in the job description). */
  display: string;
  importance: Importance;
  /** Occurrences in the job description. */
  count: number;
}

export const IMPORTANCE_WEIGHT: Record<Importance, number> = { required: 3, preferred: 2, general: 1 };

/** Lower-case, apply phrase aliases, drop punctuation. Both resume and JD go through this. */
export function normalize(text: string): string {
  let t = ` ${text.toLowerCase().replace(/[’']/g, "")} `;
  for (const [re, to] of ALIASES) t = t.replace(re, ` ${to} `);
  return t.replace(/[^a-z0-9]+/g, " ").trim();
}

/** Light singularisation so "APIs" matches "API". Applied identically to both sides. */
function stem(w: string): string {
  return w.length > 3 && w.endsWith("s") && !w.endsWith("ss") && !w.endsWith("us") && w !== "kubernetes" && w !== "analytics" ? w.slice(0, -1) : w;
}

export function tokens(text: string): string[] {
  return normalize(text).split(" ").filter(Boolean).map(stem);
}

/** Every 1 to 3 word phrase of a token list. */
function ngrams(toks: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < toks.length; i++) {
    out.push(toks[i]);
    if (i + 1 < toks.length) out.push(`${toks[i]} ${toks[i + 1]}`);
    if (i + 2 < toks.length) out.push(`${toks[i]} ${toks[i + 1]} ${toks[i + 2]}`);
  }
  return out;
}

const canonSkill = (s: string) => tokens(s).join(" ");
const SKILL_SET = new Map(SKILLS.filter((s) => s.length > 1).map((s) => [canonSkill(s), s]));

export function resumeTerms(resume: string): Set<string> {
  return new Set(ngrams(tokens(resume)));
}

type Section = Importance;

/**
 * Pull the terms that matter out of a job description: known skills, plus any other word that
 * the posting repeats. Each term is marked required / preferred / general from the heading it sits
 * under ("Requirements", "Nice to have") and cue words on its own line ("must", "bonus").
 */
export function extractKeywords(jd: string, limit = 30): Keyword[] {
  const found = new Map<string, Keyword>();
  const rank: Record<Importance, number> = { general: 0, preferred: 1, required: 2 };
  let section: Section = "general";

  const note = (term: string, display: string, importance: Importance) => {
    const cur = found.get(term);
    if (!cur) found.set(term, { term, display, importance, count: 1 });
    else {
      cur.count++;
      if (rank[importance] > rank[cur.importance]) cur.importance = importance;
    }
  };

  for (const raw of jd.split(/\n+/)) {
    const line = raw.trim();
    if (!line) continue;
    const bare = line.replace(/^[#*\-•\s]+/, "").replace(/[:*\s]+$/, "");
    // A bulleted line is content, never a heading, however short ("- Kubernetes").
    const isHeading = !/^[-•*·]\s/.test(line) && bare.length <= 50 && !/[.!?]$/.test(bare) && (/:$/.test(line) || /^[A-Z][^a-z]*$/.test(bare) || bare.split(/\s+/).length <= 6);
    if (isHeading && REQUIRED_HEADINGS.test(bare)) section = "required";
    else if (isHeading && PREFERRED_HEADINGS.test(bare)) section = "preferred";
    else if (isHeading && bare.split(/\s+/).length <= 4 && /^[A-Z]/.test(bare) && !REQUIRED_CUES.test(bare)) section = "general";

    let lineLevel: Importance = section;
    if (PREFERRED_CUES.test(line)) lineLevel = "preferred";
    else if (REQUIRED_CUES.test(line) && !isHeading) lineLevel = "required";

    const toks = tokens(line);
    const original = new Map<string, string>();
    for (const w of line.split(/[^A-Za-z0-9+#./]+/)) if (w) original.set(canonSkill(w), w);
    const seenInLine = new Set<string>();
    for (const g of ngrams(toks)) {
      if (seenInLine.has(g)) continue;
      const skill = SKILL_SET.get(g);
      if (skill) {
        seenInLine.add(g);
        note(g, skill, lineLevel);
      } else if (!g.includes(" ") && g.length >= 3 && !STOP_WORDS.has(g) && !/^\d+$/.test(g)) {
        seenInLine.add(g);
        note(g, original.get(g) ?? g, lineLevel);
      }
    }
  }

  // Unknown single words only count when the posting repeats them; known skills always count.
  const kept = [...found.values()].filter((k) => SKILL_SET.has(k.term) || k.count >= 2);
  kept.sort(
    (a, b) =>
      IMPORTANCE_WEIGHT[b.importance] * (SKILL_SET.has(b.term) ? 2 : 1) * b.count -
        IMPORTANCE_WEIGHT[a.importance] * (SKILL_SET.has(a.term) ? 2 : 1) * a.count || a.term.localeCompare(b.term),
  );
  return kept.slice(0, limit).map((k) => {
    const skill = SKILL_SET.get(k.term);
    return { ...k, display: skill ? pretty(skill) : k.display.toLowerCase() };
  });
}

export const isKnownSkill = (term: string) => SKILL_SET.has(term);

const PRETTY: Record<string, string> = {
  cicd: "CI/CD", nextjs: "Next.js", cpp: "C++", csharp: "C#", dotnet: ".NET", sqlserver: "SQL Server", node: "Node.js",
  postgresql: "PostgreSQL", mysql: "MySQL", mongodb: "MongoDB", graphql: "GraphQL", javascript: "JavaScript", typescript: "TypeScript",
  fastapi: "FastAPI", "rest api": "REST API", "power bi": "Power BI", tensorflow: "TensorFlow", pytorch: "PyTorch",
  "github actions": "GitHub Actions", dynamodb: "DynamoDB", "a/b testing": "A/B testing", elasticsearch: "Elasticsearch",
};
const ACRONYMS = new Set(["sql", "aws", "gcp", "nlp", "etl", "html", "css", "tdd", "api", "php", "dbt"]);

/** Readable form of a dictionary skill ("cicd" becomes "CI/CD"). */
export function pretty(skill: string): string {
  if (PRETTY[skill]) return PRETTY[skill];
  if (ACRONYMS.has(skill)) return skill.toUpperCase();
  return skill.replace(/^./, (c) => c.toUpperCase());
}
