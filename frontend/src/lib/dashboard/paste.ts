import { z } from "zod";
import { fieldErrors, type FieldErrors } from "@/lib/validation";

/** Sites NextRole will not fetch (their terms forbid it). The user can still paste the text. */
export const BLOCKED_HOSTS = /(^|\.)(linkedin\.com|indeed\.com|naukri\.com)$/i;

export const pasteSchema = z
  .object({
    url: z.string().trim().max(2000, "That link is too long."),
    text: z.string().trim().max(30_000, "That is over the 30,000 character limit. Paste just the description."),
  })
  .superRefine((v, ctx) => {
    if (!v.url && !v.text) {
      ctx.addIssue({ code: "custom", path: ["text"], message: "Paste the job posting text, or a link to it." });
      return;
    }
    if (v.url) {
      let u: URL | null = null;
      try {
        u = new URL(v.url);
      } catch {
        /* reported below */
      }
      if (!u || u.protocol !== "https:") {
        ctx.addIssue({ code: "custom", path: ["url"], message: "Use a full https:// link." });
      } else if (BLOCKED_HOSTS.test(u.hostname) && !v.text) {
        ctx.addIssue({
          code: "custom",
          path: ["text"],
          message: "NextRole doesn't read LinkedIn, Indeed or Naukri pages. Paste the posting text instead (you can keep the link too).",
        });
      }
    }
    if (v.text && v.text.length < 40) {
      ctx.addIssue({ code: "custom", path: ["text"], message: "That looks too short for a job posting. Paste the full description." });
    }
  });

export function validatePaste(v: { url: string; text: string }): FieldErrors<"url" | "text"> {
  const r = pasteSchema.safeParse(v);
  return r.success ? {} : fieldErrors(r.error);
}
