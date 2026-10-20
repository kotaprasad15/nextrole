/**
 * Static data for the ATS check: phrase aliases, a curated skills dictionary and stop words.
 * Deliberately small and readable; the engine is a transparent heuristic, not a black box.
 */

/** Rewritten BEFORE tokenising so "Node.js", "k8s" or "C++" survive as single comparable terms. */
export const ALIASES: [RegExp, string][] = [
  [/\bnode\.?js\b/g, "node"],
  [/\breact\.?js\b/g, "react"],
  [/\bvue\.?js\b/g, "vue"],
  [/\bnext\.?js\b/g, "nextjs"],
  [/\bexpress\.?js\b/g, "express"],
  [/\bk8s\b/g, "kubernetes"],
  [/\bci\s*\/\s*cd\b/g, "cicd"],
  [/\bpostgres(?:ql)?\b/g, "postgresql"],
  [/\bgolang\b/g, "go"],
  [/\bjs\b/g, "javascript"],
  [/\bts\b/g, "typescript"],
  [/\bml\b/g, "machine learning"],
  [/\bc\+\+/g, "cpp"],
  [/\bc#/g, "csharp"],
  [/(?:^|\s)\.net\b/g, " dotnet"],
  [/\brest(?:ful)?\s+apis?\b/g, "rest api"],
  [/\bfull[\s-]stack\b/g, "fullstack"],
  [/\bfront[\s-]end\b/g, "frontend"],
  [/\bback[\s-]end\b/g, "backend"],
  [/\bunit[\s-]test(?:ing|s)?\b/g, "unit testing"],
  [/\bamazon web services\b/g, "aws"],
  [/\bgoogle cloud(?: platform)?\b/g, "gcp"],
  [/\bsql server\b/g, "sqlserver"],
];

/** Skills and practices worth matching as whole terms (multi-word terms included). Lower case. */
export const SKILLS: string[] = [
  // languages
  "python", "java", "javascript", "typescript", "go", "rust", "cpp", "csharp", "kotlin", "swift", "ruby", "php", "scala", "sql", "bash", "r",
  // web / frameworks
  "react", "angular", "vue", "nextjs", "node", "express", "django", "flask", "fastapi", "spring", "rails", "graphql", "rest api", "html", "css", "tailwind", "dotnet",
  // data / ml
  "machine learning", "deep learning", "data science", "pandas", "numpy", "pytorch", "tensorflow", "spark", "airflow", "dbt", "etl", "data pipeline", "data modeling", "tableau", "power bi", "statistics", "nlp",
  // databases
  "postgresql", "mysql", "mongodb", "redis", "elasticsearch", "dynamodb", "sqlserver", "sqlite", "kafka", "rabbitmq",
  // cloud / devops
  "aws", "azure", "gcp", "docker", "kubernetes", "terraform", "ansible", "jenkins", "cicd", "github actions", "linux", "microservices", "serverless", "observability", "prometheus", "grafana",
  // practice
  "agile", "scrum", "unit testing", "tdd", "code review", "system design", "api design", "distributed systems", "fullstack", "frontend", "backend", "devops", "security", "accessibility", "performance",
  // product / soft
  "product management", "stakeholder", "roadmap", "analytics", "a/b testing", "leadership", "mentoring", "communication", "collaboration", "problem solving",
];

/** Words that carry no signal in a job description. */
export const STOP_WORDS = new Set(
  (
    "a an and are as at be been but by can do does for from had has have he her his how i if in into is it its just may more most must no not of on or our out over own she so some such than that the their them then there these they this those to too under up us use used using was we were what when where which while who will with within without would you your yours " +
    // job-description boilerplate
    "ability able about across additional all also any apply applicants application around based become being best both bring build building business candidate candidates change clear closely company complex create day days deliver develop developing development drive each effective efficient employer end enjoy environment equal essential etc excellent experience experienced expected familiar first following full get give good great grow growth help high highly ideal ideally impact important including individual join job key know large learn level like looking make making many meet might minimum multiple need needed needs new next nice offer one opportunity organization other part passion passionate people plus position preferred problems process product products proven provide qualifications quality range related relevant remote report require required requirements responsibilities responsible role roles same see seek senior setting should skills solutions solving strong successful support take team teams tech technical technologies technology things think time together tools top track understand understanding up well work working works world year years you'll we're"
  ).split(/\s+/),
);

export const REQUIRED_CUES = /\b(required|requires?|must|essential|minimum|mandatory|need(?:ed)?|you have|you will have|requirements?)\b/i;
export const PREFERRED_CUES = /\b(nice to have|preferred|bonus|a plus|desirable|ideally|good to have|familiarity|exposure)\b/i;
export const REQUIRED_HEADINGS = /^(?:key\s+)?(?:requirements?|qualifications?|what you(?:'|’)ll bring|what we(?:'|’)re looking for|must[- ]haves?|you have|about you|who you are)\b/i;
export const PREFERRED_HEADINGS = /^(?:nice[- ]to[- ]haves?|preferred(?: qualifications)?|bonus(?: points)?|a plus|desirable)\b/i;
