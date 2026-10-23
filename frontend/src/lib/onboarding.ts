/**
 * Onboarding wizard rules. The backend takes everything in ONE multipart call that also parses
 * the resume, so steps 1 and 2 are held in memory and sent together with the resume at step 3.
 */
import { z } from "zod";
import type { Profile } from "./api/schemas";
import { fieldErrors, type FieldErrors } from "./validation";

export const EXPERIENCE_LEVELS = [
  { value: "Intern / New grad", label: "Intern / New grad", hint: "Studying or recently graduated" },
  { value: "Junior", label: "Junior", hint: "Up to about 2 years" },
  { value: "Mid", label: "Mid-level", hint: "About 3 to 6 years" },
  { value: "Senior", label: "Senior", hint: "7 or more years, or leading others" },
] as const;

export const ROLE_SUGGESTIONS = ["SDE", "Backend Engineer", "Frontend Engineer", "Full-Stack Engineer", "Forward Deployed Engineer", "Data Engineer", "Machine Learning Engineer", "Product Manager"];
export const LOCATION_SUGGESTIONS = ["Bengaluru", "Remote", "London", "Berlin", "New York", "Singapore"];

export interface Wizard {
  roles: string[];
  locations: string[];
  remote_ok: boolean;
  experience_level: string;
  extras: string;
  resume: File | null;
}

export const EMPTY_WIZARD: Wizard = { roles: [], locations: [], remote_ok: true, experience_level: "", extras: "", resume: null };

export const rolesStep = z.object({
  roles: z.array(z.string()).min(1, "Add at least one role you are looking for."),
});

/** Locations are optional when remote is allowed; otherwise at least one is needed to search. */
export const whereStep = z
  .object({
    locations: z.array(z.string()),
    remote_ok: z.boolean(),
    experience_level: z.string().min(1, "Pick the level that fits you best."),
  })
  .refine((v) => v.remote_ok || v.locations.length > 0, {
    path: ["locations"],
    message: "Add a location, or allow remote roles.",
  });

export const extrasMax = 1000;

export function validateStep(step: "roles" | "where", w: Wizard): FieldErrors {
  const result = step === "roles" ? rolesStep.safeParse(w) : whereStep.safeParse(w);
  return result.success ? {} : fieldErrors(result.error);
}

export function buildOnboardingForm(w: Wizard): FormData {
  if (!w.resume) throw new Error("resume required");
  const form = new FormData();
  form.set("roles", w.roles.join(", "));
  form.set("locations", w.locations.join(", "));
  form.set("remote_ok", String(w.remote_ok));
  form.set("experience_level", w.experience_level);
  form.set("extras", w.extras.trim());
  form.set("resume", w.resume);
  return form;
}

export const reviewSchema = z.object({
  name: z.string().trim().min(1, "Add your name."),
  summary: z.string().max(2000, "Keep the summary under 2000 characters."),
  skills: z.array(z.string()),
});

export function validateReview(p: Profile): FieldErrors {
  const result = reviewSchema.safeParse(p);
  return result.success ? {} : fieldErrors(result.error);
}
