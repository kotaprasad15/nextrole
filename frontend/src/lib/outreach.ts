import type { Outreach, OutreachStatus } from "@/lib/api/schemas";
import { EMAIL_RE } from "@/lib/validation";

export const DRAFT_STATUS_LABEL: Record<OutreachStatus, string> = {
  draft: "Needs review",
  critic_passed: "Reviewer passed",
  user_approved: "Approved",
};

/** Names for the Critic's rubric keys; unknown keys are shown humanised. */
export const CRITERIA_LABEL: Record<string, string> = {
  specificity: "Specific to this job",
  grounding: "Backed by your facts",
  tone: "Tone",
  no_fluff: "No filler",
  length: "Length",
};

export const criterionLabel = (key: string) => CRITERIA_LABEL[key] ?? key.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

export function wordCount(text: string): number {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

/** Plain text for the clipboard: email drafts include the subject line. */
export function copyText(channel: Outreach["channel"], subject: string, body: string): string {
  return channel === "email" ? `Subject: ${subject}\n\n${body}` : body;
}

/** `mailto:` link built client-side from the address the user typed. Null if it is not a valid address. */
export function mailtoUrl(to: string, subject: string, body: string): string | null {
  const addr = to.trim();
  if (!EMAIL_RE.test(addr)) return null;
  return `mailto:${encodeURIComponent(addr).replace(/%40/g, "@")}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

export function gmailComposeUrl(to: string, subject: string, body: string): string {
  const q = new URLSearchParams({ view: "cm", fs: "1", to: to.trim(), su: subject, body });
  return `https://mail.google.com/mail/?${q}`;
}

/** True when the Critic has not vouched for this draft (never reviewed, or asked for a revision). */
export function unverified(d: Pick<Outreach, "critic">): boolean {
  return !d.critic || d.critic.verdict !== "pass" || d.critic.unsupported_claims.length > 0 || d.critic.violations.length > 0;
}

/** Only https source links are ever rendered as links (the backend guarantees this, we re-check). */
export const safeSource = (ref: string | null): string | null => (ref && ref.startsWith("https://") ? ref : null);
