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

export const signupSchema = z.object({
  email: emailSchema,
  password: z
    .string()
    .min(8, "Use at least 8 characters.")
    .max(256, "That password is too long (256 characters at most)."),
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

export type StrengthLevel = 0 | 1 | 2 | 3;

/**
 * ADVISORY password strength (length and character variety). It never blocks submission beyond
 * the real 8-character rule, and is not a substitute for a breached-password check.
 */
export function passwordStrength(pw: string): { level: StrengthLevel; label: string } {
  if (!pw) return { level: 0, label: "" };
  let score = 0;
  if (pw.length >= 8) score++;
  if (pw.length >= 12) score++;
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((r) => r.test(pw)).length;
  if (classes >= 3) score++;
  if (pw.length < 8) return { level: 1, label: "Too short" };
  if (score <= 1) return { level: 1, label: "Weak" };
  if (score === 2) return { level: 2, label: "Good" };
  return { level: 3, label: "Strong" };
}
