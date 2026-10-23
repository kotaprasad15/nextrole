import { z } from "zod";

/** Option lists mirror src/nextrole/interviews/schemas.py (the server is the authority). */
export const LEVELS = [
  { value: "intern", label: "Intern" }, { value: "new_grad", label: "New grad" }, { value: "junior", label: "Junior" },
  { value: "mid", label: "Mid-level" }, { value: "senior", label: "Senior" }, { value: "staff", label: "Staff and above" },
  { value: "manager", label: "Manager" }, { value: "other", label: "Other" },
] as const;
export const OUTCOMES = [
  { value: "offer", label: "Got an offer" }, { value: "rejected", label: "Rejected" },
  { value: "withdrew", label: "I withdrew" }, { value: "no_decision", label: "No decision yet" },
] as const;
export const ROUND_TYPES = [
  { value: "recruiter_screen", label: "Recruiter screen" }, { value: "online_assessment", label: "Online assessment" },
  { value: "coding", label: "Coding" }, { value: "system_design", label: "System design" }, { value: "behavioral", label: "Behavioral" },
  { value: "take_home", label: "Take-home project" }, { value: "hiring_manager", label: "Hiring manager" },
  { value: "onsite_loop", label: "Onsite loop" }, { value: "other", label: "Other" },
] as const;
export const REPORT_REASONS = [
  { value: "pii", label: "Shares personal details" }, { value: "confidential", label: "Shares confidential company information" },
  { value: "harassment", label: "Attacks or harasses someone" }, { value: "spam", label: "Spam or an advert" },
  { value: "inaccurate", label: "Looks made up or inaccurate" }, { value: "other", label: "Something else" },
] as const;
export const DIFFICULTY_LABEL = ["", "Very easy", "Easy", "Medium", "Hard", "Very hard"] as const;

export const labelOf = (list: readonly { value: string; label: string }[], value: string) => list.find((o) => o.value === value)?.label ?? value;

/** Personal data the server refuses. Checked early so people can fix it before submitting (the server re-checks). */
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const PHONE = /(?<![\w.])\+?\d[\d\s().-]{8,}\d(?![\w.])/;
const LINK = /\b(?:https?:\/\/|www\.)\S+|linkedin\.com/i;
export function personalDataProblems(text: string): string[] {
  const out: string[] = [];
  if (EMAIL.test(text)) out.push("email addresses");
  if (PHONE.test(text)) out.push("phone numbers");
  if (LINK.test(text)) out.push("links");
  return out;
}

const nowMonth = () => new Date().toISOString().slice(0, 7);
export const experienceFormSchema = z.object({
  company: z.string().trim().min(1, "Enter the company.").max(80, "That name is too long."),
  role: z.string().trim().min(1, "Enter the role.").max(80, "That role is too long."),
  level: z.string().min(1, "Choose a level."),
  interviewed_on: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Choose the month.").refine((v) => v <= nowMonth(), "The interview cannot be in the future."),
  rounds: z.array(z.object({ type: z.string().min(1), difficulty: z.number().min(1).max(5), notes: z.string().max(600, "Keep each round under 600 characters.") })).min(1, "Add at least one round.").max(10),
  difficulty: z.number().min(1, "Rate the overall difficulty.").max(5),
  outcome: z.string().min(1, "Choose the outcome."),
  tips: z.string().max(1500, "Keep tips under 1500 characters."),
  anonymous: z.boolean(),
}).superRefine((v, ctx) => {
  if (!v.tips.trim() && !v.rounds.some((r) => r.notes.trim())) ctx.addIssue({ code: "custom", path: ["tips"], message: "Add a few notes about the rounds or some tips, so others can learn from it." });
  const bad = personalDataProblems([v.company, v.role, v.tips, ...v.rounds.map((r) => r.notes)].join("\n"));
  if (bad.length) ctx.addIssue({ code: "custom", path: ["tips"], message: `Please remove ${bad.join(", ")}. Posts are public to other members.` });
});
