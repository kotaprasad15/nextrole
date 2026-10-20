import { ChevronDown } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { HOME_SECTIONS } from "@/lib/marketing/constants";

export const FAQS = [
  {
    q: "Does NextRole send emails for me?",
    a: "No. It writes drafts. You read and edit them, approve one, and then open it in your own mail app or Gmail and press send yourself. There is no send button anywhere in the product.",
  },
  {
    q: "Where do the jobs come from?",
    a: "From the public job boards of the companies NextRole watches (Greenhouse, Lever and Ashby), and the Apply link is the company's own. It does not scrape LinkedIn, Indeed or Naukri. If you find a role elsewhere, paste its text and NextRole will score it and draft outreach for it.",
  },
  {
    q: "How do you stop the draft from making things up?",
    a: "The Writer may only use a closed set of facts: your profile, the job posting and sourced company research. It cites each one, a Critic checks the draft against them, and you can see the list of facts on the draft. You are still the final reader.",
  },
  {
    q: "What happens to my resume?",
    a: "It is stored encrypted, and the text is sent to the AI model provider your NextRole is configured with to build your profile. You can edit the profile and delete your account and data whenever you like.",
  },
  {
    q: "Is the ATS check the real thing?",
    a: "No. It is a heuristic estimate of keyword coverage, structure and formatting, and it runs entirely in your browser with no upload and no AI model. It will never tell you to add a skill you do not have.",
  },
];

export function Faq() {
  return (
    <section id="faq" data-section={HOME_SECTIONS.faq} aria-labelledby="faq-title" className="scroll-mt-16 pb-[var(--section-y)]">
      <div className="marketing-container grid gap-10 lg:grid-cols-[0.8fr_1.2fr]">
        <h2 id="faq-title" className="font-display text-display-lg text-balance">Questions, answered plainly</h2>
        <div className="divide-y divide-border rounded-card border border-border bg-surface">
          {FAQS.map((f) => (
            <details key={f.q} className="group px-5 py-4 [&_summary::-webkit-details-marker]:hidden">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 rounded-control text-left font-semibold" data-cursor="link">
                {f.q}
                <ChevronDown className="size-5 shrink-0 text-muted transition-transform duration-200 group-open:rotate-180" aria-hidden />
              </summary>
              <p className="mt-3 max-w-2xl text-body text-muted">{f.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

export function FinalCta() {
  return (
    <section data-section={HOME_SECTIONS.start} aria-labelledby="cta-title" className="pb-[var(--section-y)]">
      <div className="marketing-container">
        <div className="relative isolate overflow-hidden rounded-card border border-border bg-surface px-6 py-16 text-center shadow-2 md:px-12">
          <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
            <div className="absolute -left-20 -top-20 size-80 rounded-full bg-startup/15 blur-3xl" />
            <div className="absolute -bottom-24 left-1/3 size-80 rounded-full bg-mid/15 blur-3xl" />
            <div className="absolute -right-20 -top-10 size-80 rounded-full bg-mnc/15 blur-3xl" />
          </div>
          <h2 id="cta-title" className="font-display text-display-lg text-balance">Ready to find your next role?</h2>
          <p className="mx-auto mt-4 max-w-xl text-body-lg text-muted">Start with your resume. It takes about two minutes, and you stay in control of everything that gets written.</p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Button asChild size="lg" magnetic fx="glow">
              <Link href="/signup">Create your account</Link>
            </Button>
            <Button asChild size="lg" variant="secondary" fx="outline">
              <Link href="/login">Log in</Link>
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
