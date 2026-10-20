import { Mail, Search, Sparkles } from "lucide-react";
import { Logo } from "@/components/shell/logo";
import { TierBadge } from "@/components/ui/badge";
import { ScoreRing } from "@/components/ui/score-ring";

const POINTS = [
  { icon: Search, title: "Real openings only", text: "Jobs come straight from company job boards, with the real application link." },
  { icon: Sparkles, title: "Sorted by company type", text: "Startups, mid-size companies and MNCs, each with a reason it fits you." },
  { icon: Mail, title: "Outreach that sounds like you", text: "Drafts use only facts from your resume and the posting. You send them." },
];

/** Brand panel for the split-screen auth pages (desktop only). Static: no data, no animation. */
export function AuthShowcase() {
  return (
    <aside
      aria-label="About NextRole"
      className="relative hidden overflow-hidden border-r border-border bg-surface lg:flex lg:flex-col lg:justify-between lg:p-12"
    >
      {/* Soft colour wash: three tier-coloured blobs, very light. */}
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="absolute -left-24 -top-24 size-96 rounded-full bg-startup/15 blur-3xl" />
        <div className="absolute -bottom-32 left-1/3 size-[28rem] rounded-full bg-mid/15 blur-3xl" />
        <div className="absolute -right-24 top-1/4 size-96 rounded-full bg-mnc/15 blur-3xl" />
      </div>

      <div className="relative">
        <Logo />
        <h2 className="mt-14 max-w-md font-display text-display-lg text-balance">
          Your next role, found and <em className="text-primary">ready to send</em>.
        </h2>
        <ul className="mt-10 flex max-w-md flex-col gap-6">
          {POINTS.map(({ icon: Icon, title, text }) => (
            <li key={title} className="flex gap-4">
              <span className="grid size-10 shrink-0 place-items-center rounded-control bg-primary-tint text-primary">
                <Icon className="size-5" aria-hidden />
              </span>
              <div>
                <p className="font-semibold">{title}</p>
                <p className="mt-0.5 text-small text-muted">{text}</p>
              </div>
            </li>
          ))}
        </ul>
      </div>

      {/* A representative card: shows what the product produces. Illustrative sample data. */}
      <div className="relative mt-12 max-w-md rounded-card border border-border bg-surface/90 p-5 shadow-2 backdrop-blur">
        <div className="flex items-start justify-between gap-4">
          <div>
            <TierBadge tier="startup" short />
            <p className="mt-2 font-semibold">Software Engineer, Platform</p>
            <p className="text-small text-muted">Lumen Labs · Remote (EU)</p>
          </div>
          <ScoreRing value={86} tone="startup" size={64} label="Sample match score" caption="match" />
        </div>
        <p className="mt-3 text-small text-ink/80">Your FastAPI and PostgreSQL work matches their API-first stack.</p>
        <p className="mt-3 text-caption text-muted">Sample data, for illustration.</p>
      </div>
    </aside>
  );
}
