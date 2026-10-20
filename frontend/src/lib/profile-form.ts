import type { Profile } from "@/lib/api/schemas";

export type ProfileErrors = Record<string, string>;

export const SUMMARY_MAX = 2000;

/** Trim text, drop empty skills/bullets/tech, so the saved profile has no blank noise. */
export function cleanProfile(p: Profile): Profile {
  const list = (xs: string[]) => xs.map((x) => x.trim()).filter(Boolean);
  return {
    ...p,
    name: p.name.trim(),
    summary: p.summary.trim(),
    skills: list(p.skills),
    experience: p.experience.map((e) => ({ ...e, company: e.company.trim(), title: e.title.trim(), start: e.start.trim(), end: e.end.trim(), bullets: list(e.bullets) })),
    projects: p.projects.map((x) => ({ ...x, name: x.name.trim(), description: x.description.trim(), tech: list(x.tech) })),
    education: p.education.map((x) => ({ ...x, institution: x.institution.trim(), degree: x.degree.trim(), year: x.year.trim() })),
    preferences: { ...p.preferences, roles: list(p.preferences.roles), locations: list(p.preferences.locations), extras: p.preferences.extras.trim() },
  };
}

/** Field errors keyed by path ("name", "experience.0.company"). Empty object means valid. */
export function validateProfile(p: Profile): ProfileErrors {
  const e: ProfileErrors = {};
  if (!p.name.trim()) e.name = "Add your name.";
  if (p.summary.length > SUMMARY_MAX) e.summary = `Keep the summary under ${SUMMARY_MAX} characters.`;
  p.experience.forEach((x, i) => {
    if (!x.company.trim()) e[`experience.${i}.company`] = "Add the company.";
    if (!x.title.trim()) e[`experience.${i}.title`] = "Add your job title.";
  });
  p.projects.forEach((x, i) => {
    if (!x.name.trim()) e[`projects.${i}.name`] = "Give the project a name.";
  });
  p.education.forEach((x, i) => {
    if (!x.institution.trim()) e[`education.${i}.institution`] = "Add the school or university.";
  });
  if (p.preferences.roles.filter((r) => r.trim()).length === 0) e.roles = "Keep at least one role so we know what to search for.";
  if (!p.preferences.remote_ok && p.preferences.locations.filter((l) => l.trim()).length === 0) e.locations = "Add a location, or allow remote roles.";
  return e;
}

/** Which tab holds the first error, so the UI can jump there. */
export function errorTab(errors: ProfileErrors): "profile" | "preferences" | null {
  const keys = Object.keys(errors);
  if (!keys.length) return null;
  return keys.some((k) => k !== "roles" && k !== "locations") ? "profile" : "preferences";
}

export const isDirty = (draft: Profile, saved: Profile) => JSON.stringify(draft) !== JSON.stringify(saved);

export const blankExperience = () => ({ company: "", title: "", start: "", end: "", bullets: [] as string[] });
export const blankProject = () => ({ name: "", description: "", tech: [] as string[] });
export const blankEducation = () => ({ institution: "", degree: "", year: "" });
