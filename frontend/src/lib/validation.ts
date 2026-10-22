/**
 * Form validation. Rules deliberately mirror the backend (src/nextrole/api/routers/auth.py:
 * email regex, 8 to 256 character password, email <= 254) so users see an error BEFORE a round
 * trip, while the server stays the authority. Server errors are mapped back onto fields.
 */
import { z } from "zod";

export const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export const emailSchema = z
  .string()
  .trim()
  .min(1, "Enter your email address.")
  .max(254, "That email address is too long.")
  .regex(EMAIL_RE, "Enter a valid email address, like name@example.com.");

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Enter your password."),
});

/**
 * Password rules for NEW passwords. Mirrors src/nextrole/auth/policy.py (the server is the
 * authority and re-checks everything). Login accepts any existing password.
 */
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 256;
export const PASSWORD_RULES = [
  { id: "length", label: `At least ${PASSWORD_MIN} characters`, test: (p: string) => p.length >= PASSWORD_MIN },
  { id: "upper", label: "One uppercase letter", test: (p: string) => /\p{Lu}/u.test(p) },
  { id: "lower", label: "One lowercase letter", test: (p: string) => /\p{Ll}/u.test(p) },
  // Special = not a letter, digit or whitespace (same definition as the backend).
  { id: "special", label: "One special character, like ! ? # %", test: (p: string) => /[^\p{L}\p{N}\s]/u.test(p) },
] as const;

export const unmetPasswordRules = (password: string) => PASSWORD_RULES.filter((r) => !r.test(password));

export const signupSchema = z
  .object({
    email: emailSchema,
    password: z.string().max(PASSWORD_MAX, `That password is too long (${PASSWORD_MAX} characters at most).`),
    confirmPassword: z.string(),
  })
  .superRefine((v, ctx) => {
    const unmet = unmetPasswordRules(v.password);
    if (unmet.length) {
      ctx.addIssue({
        code: "custom",
        path: ["password"],
        message: v.password ? `Your password still needs: ${unmet.map((r) => r.label.toLowerCase()).join(", ")}.` : "Choose a password.",
      });
    }
    if (v.confirmPassword !== v.password) {
      ctx.addIssue({ code: "custom", path: ["confirmPassword"], message: "The two passwords do not match." });
    }
  });

export type FieldErrors<K extends string = string> = Partial<Record<K, string>>;

/** First message per field from a Zod error, ready to hand to <Field error>. */
export function fieldErrors<K extends string>(error: z.ZodError): FieldErrors<K> {
  const out: FieldErrors<K> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0]) as K;
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}
