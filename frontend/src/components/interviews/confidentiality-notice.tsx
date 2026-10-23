import { ShieldAlert } from "lucide-react";

/** Shown on the browse page and on the form: what must NOT be shared. The server enforces the hard rules. */
export function ConfidentialityNotice({ compact = false }: { compact?: boolean }) {
  return (
    <aside aria-label="What not to share" className="flex items-start gap-3 rounded-card border border-warning/40 bg-warning-tint p-4 text-small text-warning-ink">
      <ShieldAlert className="mt-0.5 size-5 shrink-0" aria-hidden />
      <div>
        <p className="font-semibold">Please do not share confidential or proprietary company information.</p>
        <p className="mt-1">
          Describe the kinds of questions and how the process felt, not exact questions, take-home answers, source code or internal documents, and nothing covered by an NDA.
          {!compact && " Do not include names, emails, phone numbers or links. Every post is reviewed by a moderator before it is published, and you can edit or delete yours at any time."}
        </p>
      </div>
    </aside>
  );
}
