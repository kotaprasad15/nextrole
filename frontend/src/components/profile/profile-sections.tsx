"use client";

import { Plus, Trash2, X } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Input, Textarea } from "@/components/ui/field";
import { RadioCards } from "@/components/ui/radio-cards";
import { Switch } from "@/components/ui/switch";
import { TagInput } from "@/components/ui/tag-input";
import type { Profile } from "@/lib/api/schemas";
import { EXPERIENCE_LEVELS, LOCATION_SUGGESTIONS, ROLE_SUGGESTIONS, extrasMax } from "@/lib/onboarding";
import { SUMMARY_MAX, blankEducation, blankExperience, blankProject, type ProfileErrors } from "@/lib/profile-form";

interface Props {
  draft: Profile;
  onChange: (next: Profile) => void;
  errors: ProfileErrors;
}

const replaceAt = <T,>(xs: T[], i: number, v: T) => xs.map((x, j) => (j === i ? v : x));
const removeAt = <T,>(xs: T[], i: number) => xs.filter((_, j) => j !== i);

function Section({ title, description, children, action }: { title: string; description?: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section aria-label={title}>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-h2 font-semibold tracking-tight">{title}</h2>
          {description && <p className="mt-1 text-small text-muted">{description}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function ItemCard({ label, onRemove, children }: { label: string; onRemove: () => void; children: ReactNode }) {
  return (
    <Card className="relative">
      <Button variant="ghost" size="sm" data-edit-only className="absolute right-3 top-3 text-danger-ink" onClick={onRemove} aria-label={`Remove ${label}`}>
        <Trash2 className="size-4" aria-hidden /> Remove
      </Button>
      <div className="grid gap-4 pt-8 sm:grid-cols-2 sm:pt-0">{children}</div>
    </Card>
  );
}

/** About you, skills, experience, projects, education. */
export function ProfileSections({ draft, onChange, errors }: Props) {
  const set = (patch: Partial<Profile>) => onChange({ ...draft, ...patch });

  return (
    <div className="flex flex-col gap-10">
      <Section title="About you">
        <Card className="flex flex-col gap-5">
          <Field label="Name" error={errors.name}>
            <Input value={draft.name} onChange={(e) => set({ name: e.target.value })} autoComplete="name" />
          </Field>
          <Field label="Summary" error={errors.summary} hint={`${draft.summary.length}/${SUMMARY_MAX}. Two or three lines on who you are and what you do.`}>
            <Textarea value={draft.summary} onChange={(e) => set({ summary: e.target.value })} />
          </Field>
          <Field label="Skills" hint="Press Enter after each. Matching and drafts use these.">
            <TagInput value={draft.skills} onChange={(skills) => set({ skills })} noun="skill" max={60} placeholder="Add a skill" />
          </Field>
        </Card>
      </Section>

      <Section
        title="Experience"
        description="Drafts can only mention what is written here."
        action={<Button variant="secondary" size="sm" data-edit-only onClick={() => set({ experience: [...draft.experience, blankExperience()] })}><Plus className="size-4" aria-hidden /> Add experience</Button>}
      >
        {draft.experience.length === 0 ? (
          <p className="text-small text-muted">No experience yet. Add internships, jobs or volunteering.</p>
        ) : (
          <div className="flex flex-col gap-4">
            {draft.experience.map((x, i) => (
              <ItemCard key={i} label={`experience ${x.company || i + 1}`} onRemove={() => set({ experience: removeAt(draft.experience, i) })}>
                <Field label="Company" error={errors[`experience.${i}.company`]}>
                  <Input value={x.company} onChange={(e) => set({ experience: replaceAt(draft.experience, i, { ...x, company: e.target.value }) })} />
                </Field>
                <Field label="Job title" error={errors[`experience.${i}.title`]}>
                  <Input value={x.title} onChange={(e) => set({ experience: replaceAt(draft.experience, i, { ...x, title: e.target.value }) })} />
                </Field>
                <Field label="Start">
                  <Input value={x.start} placeholder="Jun 2025" onChange={(e) => set({ experience: replaceAt(draft.experience, i, { ...x, start: e.target.value }) })} />
                </Field>
                <Field label="End">
                  <Input value={x.end} placeholder="Present" onChange={(e) => set({ experience: replaceAt(draft.experience, i, { ...x, end: e.target.value }) })} />
                </Field>
                <div className="sm:col-span-2">
                  <p className="mb-1.5 text-small font-medium">What you did</p>
                  <ul className="flex flex-col gap-2">
                    {x.bullets.map((b, bi) => (
                      <li key={bi} className="flex gap-2">
                        <Input
                          aria-label={`Bullet ${bi + 1} for ${x.company || "this role"}`}
                          value={b}
                          onChange={(e) => set({ experience: replaceAt(draft.experience, i, { ...x, bullets: replaceAt(x.bullets, bi, e.target.value) }) })}
                        />
                        <Button variant="ghost" size="icon" data-edit-only aria-label={`Remove bullet ${bi + 1}`} onClick={() => set({ experience: replaceAt(draft.experience, i, { ...x, bullets: removeAt(x.bullets, bi) }) })}>
                          <X className="size-4" aria-hidden />
                        </Button>
                      </li>
                    ))}
                  </ul>
                  <Button variant="ghost" size="sm" data-edit-only className="mt-2" onClick={() => set({ experience: replaceAt(draft.experience, i, { ...x, bullets: [...x.bullets, ""] }) })}>
                    <Plus className="size-4" aria-hidden /> Add a bullet
                  </Button>
                </div>
              </ItemCard>
            ))}
          </div>
        )}
      </Section>

      <Section
        title="Projects"
        action={<Button variant="secondary" size="sm" data-edit-only onClick={() => set({ projects: [...draft.projects, blankProject()] })}><Plus className="size-4" aria-hidden /> Add project</Button>}
      >
        {draft.projects.length === 0 ? (
          <p className="text-small text-muted">No projects yet.</p>
        ) : (
          <div className="flex flex-col gap-4">
            {draft.projects.map((x, i) => (
              <ItemCard key={i} label={`project ${x.name || i + 1}`} onRemove={() => set({ projects: removeAt(draft.projects, i) })}>
                <Field label="Project name" error={errors[`projects.${i}.name`]}>
                  <Input value={x.name} onChange={(e) => set({ projects: replaceAt(draft.projects, i, { ...x, name: e.target.value }) })} />
                </Field>
                <Field label="Tech used">
                  <TagInput value={x.tech} noun="technology" max={20} onChange={(tech) => set({ projects: replaceAt(draft.projects, i, { ...x, tech }) })} placeholder="Add a technology" />
                </Field>
                <Field label="What it does" className="sm:col-span-2">
                  <Textarea className="min-h-20" value={x.description} onChange={(e) => set({ projects: replaceAt(draft.projects, i, { ...x, description: e.target.value }) })} />
                </Field>
              </ItemCard>
            ))}
          </div>
        )}
      </Section>

      <Section
        title="Education"
        action={<Button variant="secondary" size="sm" data-edit-only onClick={() => set({ education: [...draft.education, blankEducation()] })}><Plus className="size-4" aria-hidden /> Add education</Button>}
      >
        {draft.education.length === 0 ? (
          <p className="text-small text-muted">No education yet.</p>
        ) : (
          <div className="flex flex-col gap-4">
            {draft.education.map((x, i) => (
              <ItemCard key={i} label={`education ${x.institution || i + 1}`} onRemove={() => set({ education: removeAt(draft.education, i) })}>
                <Field label="School or university" error={errors[`education.${i}.institution`]} className="sm:col-span-2">
                  <Input value={x.institution} onChange={(e) => set({ education: replaceAt(draft.education, i, { ...x, institution: e.target.value }) })} />
                </Field>
                <Field label="Degree">
                  <Input value={x.degree} onChange={(e) => set({ education: replaceAt(draft.education, i, { ...x, degree: e.target.value }) })} />
                </Field>
                <Field label="Year">
                  <Input value={x.year} inputMode="numeric" onChange={(e) => set({ education: replaceAt(draft.education, i, { ...x, year: e.target.value }) })} />
                </Field>
              </ItemCard>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}

/** What you are looking for. Same fields as onboarding steps 1 and 2. */
export function PreferencesSection({ draft, onChange, errors }: Props) {
  const p = draft.preferences;
  const set = (patch: Partial<Profile["preferences"]>) => onChange({ ...draft, preferences: { ...p, ...patch } });
  return (
    <Section title="Your search" description="These decide which openings we look for. Changes apply the next time you find matches.">
      <Card className="flex flex-col gap-5">
        <Field label="Roles" error={errors.roles} hint="Press Enter after each.">
          <TagInput value={p.roles} onChange={(roles) => set({ roles })} suggestions={ROLE_SUGGESTIONS} noun="role" max={8} placeholder="e.g. Backend Engineer" />
        </Field>
        <Field label="Locations" error={errors.locations}>
          <TagInput value={p.locations} onChange={(locations) => set({ locations })} suggestions={LOCATION_SUGGESTIONS} noun="location" max={8} placeholder="e.g. Bengaluru" />
        </Field>
        <Switch checked={p.remote_ok} onCheckedChange={(remote_ok) => set({ remote_ok })} label="Open to remote roles" description="Include fully remote openings alongside your locations." />
        <fieldset>
          <legend className="mb-1.5 text-small font-medium">Experience level</legend>
          <RadioCards label="Experience level" value={p.experience_level} onValueChange={(experience_level) => set({ experience_level })} options={[...EXPERIENCE_LEVELS]} />
        </fieldset>
        <Field label="Anything else? (optional)" hint={`${p.extras.length}/${extrasMax}`}>
          <Textarea value={p.extras} maxLength={extrasMax} onChange={(e) => set({ extras: e.target.value })} placeholder="e.g. I prefer small teams and early-stage products." />
        </Field>
      </Card>
    </Section>
  );
}
