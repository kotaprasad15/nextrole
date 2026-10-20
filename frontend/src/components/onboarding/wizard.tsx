"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, Loader2 } from "lucide-react";
import { motion } from "framer-motion";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { Field, Textarea } from "@/components/ui/field";
import { FileDropzone } from "@/components/ui/file-dropzone";
import { RadioCards } from "@/components/ui/radio-cards";
import { StepIndicator } from "@/components/ui/step-indicator";
import { Switch } from "@/components/ui/switch";
import { TagInput } from "@/components/ui/tag-input";
import { ApiError } from "@/lib/api/client";
import { api } from "@/lib/api/endpoints";
import { keys } from "@/lib/api/queries";
import type { Profile } from "@/lib/api/schemas";
import { duration, ease } from "@/lib/motion/tokens";
import { useReducedMotion } from "@/lib/motion/hooks";
import {
  EMPTY_WIZARD,
  EXPERIENCE_LEVELS,
  LOCATION_SUGGESTIONS,
  ROLE_SUGGESTIONS,
  buildOnboardingForm,
  extrasMax,
  validateReview,
  validateStep,
  type Wizard,
} from "@/lib/onboarding";
import { validateResume } from "@/lib/resume-file";
import type { FieldErrors } from "@/lib/validation";
import { ParsingPanel } from "./parsing-panel";

const STEPS = [
  { id: "roles", label: "Roles" },
  { id: "where", label: "Where" },
  { id: "resume", label: "Resume" },
  { id: "review", label: "Review" },
];

/**
 * Four steps: roles, where and level, resume, review. The backend parses the resume in the same
 * call that takes the preferences, so steps 1 and 2 are kept here and sent with the resume.
 * Review edits the parsed profile and saves it with PUT /profile. Step changes move focus to the
 * step heading so keyboard and screen-reader users land in the right place.
 */
export function OnboardingWizard() {
  const router = useRouter();
  const qc = useQueryClient();
  const reduced = useReducedMotion();
  const [step, setStep] = useState(0);
  const [w, setW] = useState<Wizard>(EMPTY_WIZARD);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [parseError, setParseError] = useState<string>();
  const [profile, setProfile] = useState<Profile | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    headingRef.current?.focus();
  }, [step]);

  const set = <K extends keyof Wizard>(k: K, v: Wizard[K]) => {
    setW((cur) => ({ ...cur, [k]: v }));
    setErrors((e) => ({ ...e, [k]: undefined }));
  };

  const parse = useMutation({
    mutationFn: () => api.onboard(buildOnboardingForm(w)),
    onSuccess: (p) => {
      qc.setQueryData(keys.profile, p);
      setProfile(p);
      setStep(3);
    },
    onError: (err) => setParseError(err instanceof ApiError ? err.message : "Something went wrong reading your resume. Please try again."),
  });

  const save = useMutation({
    mutationFn: (p: Profile) => api.saveProfile(p),
    onSuccess: (p) => {
      qc.setQueryData(keys.profile, p);
      router.replace("/dashboard");
    },
  });

  const next = (e: FormEvent) => {
    e.preventDefault();
    if (step === 0 || step === 1) {
      const errs = validateStep(step === 0 ? "roles" : "where", w);
      setErrors(errs);
      if (Object.keys(errs).length === 0) setStep(step + 1);
      return;
    }
    if (step === 2) {
      setParseError(undefined);
      if (!w.resume) return setErrors({ resume: "Choose your resume to continue." });
      const problem = validateResume(w.resume);
      if (problem) return setErrors({ resume: problem });
      setErrors({});
      parse.mutate();
    }
  };

  const back = () => {
    setErrors({});
    setParseError(undefined);
    setStep((s) => Math.max(0, s - 1));
  };

  return (
    <div className="mx-auto w-full max-w-xl">
      <StepIndicator steps={STEPS} current={step} />

      <motion.div
        key={step}
        initial={reduced ? false : { opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: duration.base, ease: ease.out }}
        className="mt-8"
      >
        {step === 0 && (
          <StepForm
            onSubmit={next}
            title="What roles are you looking for?"
            sub="Add one or more job titles. We match openings against these."
            headingRef={headingRef}
            actions={<Button type="submit" size="lg">Continue <ArrowRight className="size-5" aria-hidden /></Button>}
          >
            <Field label="Roles" error={errors.roles} hint="Press Enter or comma after each one.">
              <TagInput value={w.roles} onChange={(v) => set("roles", v)} suggestions={ROLE_SUGGESTIONS} noun="role" max={8} placeholder="e.g. Backend Engineer" />
            </Field>
          </StepForm>
        )}

        {step === 1 && (
          <StepForm
            onSubmit={next}
            title="Where, and at what level?"
            sub="Locations and level help us rank the right openings first."
            headingRef={headingRef}
            actions={
              <>
                <Button type="button" variant="ghost" size="lg" onClick={back}><ArrowLeft className="size-5" aria-hidden /> Back</Button>
                <Button type="submit" size="lg">Continue <ArrowRight className="size-5" aria-hidden /></Button>
              </>
            }
          >
            <Field label="Locations" error={errors.locations} hint="Cities or countries you would work in.">
              <TagInput value={w.locations} onChange={(v) => set("locations", v)} suggestions={LOCATION_SUGGESTIONS} noun="location" max={8} placeholder="e.g. Bengaluru" />
            </Field>
            <Switch checked={w.remote_ok} onCheckedChange={(v) => set("remote_ok", v)} label="Open to remote roles" description="Include fully remote openings alongside your locations." />
            <fieldset>
              <legend className="mb-1.5 text-small font-medium">Experience level</legend>
              <RadioCards label="Experience level" value={w.experience_level} onValueChange={(v) => set("experience_level", v)} options={[...EXPERIENCE_LEVELS]} />
              {errors.experience_level && <p role="alert" className="mt-1.5 text-caption font-medium text-danger">{errors.experience_level}</p>}
            </fieldset>
          </StepForm>
        )}

        {step === 2 &&
          (parse.isPending ? (
            <ParsingPanel />
          ) : (
            <StepForm
              onSubmit={next}
              title="Upload your resume"
              sub="We read it once to build your profile. It is stored encrypted and you can delete it any time."
              headingRef={headingRef}
              actions={
                <>
                  <Button type="button" variant="ghost" size="lg" onClick={back}><ArrowLeft className="size-5" aria-hidden /> Back</Button>
                  <Button type="submit" size="lg">Read my resume <ArrowRight className="size-5" aria-hidden /></Button>
                </>
              }
            >
              <Field label="Resume" error={errors.resume}>
                <FileDropzone file={w.resume} onFile={(f) => set("resume", f)} />
              </Field>
              {parseError && <p role="alert" className="rounded-control bg-danger-tint px-3.5 py-3 text-small font-medium text-danger-ink">{parseError}</p>}
              <Field label="Anything else we should know? (optional)" hint={`${w.extras.length}/${extrasMax}`}>
                <Textarea value={w.extras} maxLength={extrasMax} onChange={(e) => set("extras", e.target.value)} placeholder="e.g. I prefer small teams and early-stage products." />
              </Field>
            </StepForm>
          ))}

        {step === 3 && profile && (
          <ReviewStep
            profile={profile}
            onChange={setProfile}
            headingRef={headingRef}
            saving={save.isPending}
            error={save.error ? (save.error instanceof ApiError ? save.error.message : "Could not save. Please try again.") : undefined}
            onSave={() => save.mutate(profile)}
          />
        )}
      </motion.div>
    </div>
  );
}

function StepForm({
  title, sub, headingRef, onSubmit, actions, children,
}: {
  title: string;
  sub: string;
  headingRef: React.RefObject<HTMLHeadingElement | null>;
  onSubmit: (e: FormEvent) => void;
  actions: ReactNode;
  children: ReactNode;
}) {
  return (
    <form onSubmit={onSubmit} noValidate>
      <h1 ref={headingRef} tabIndex={-1} className="font-display text-display outline-none">{title}</h1>
      <p className="mt-2 text-body text-muted">{sub}</p>
      <div className="mt-8 flex flex-col gap-5">{children}</div>
      <div className="mt-8 flex flex-wrap items-center justify-between gap-3">{actions}</div>
    </form>
  );
}

function ReviewStep({
  profile, onChange, headingRef, saving, error, onSave,
}: {
  profile: Profile;
  onChange: (p: Profile) => void;
  headingRef: React.RefObject<HTMLHeadingElement | null>;
  saving: boolean;
  error?: string;
  onSave: () => void;
}) {
  const [errors, setErrors] = useState<FieldErrors>({});
  const prefs = profile.preferences;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const errs = validateReview(profile);
    setErrors(errs);
    if (Object.keys(errs).length === 0) onSave();
  };

  return (
    <form onSubmit={submit} noValidate>
      <h1 ref={headingRef} tabIndex={-1} className="font-display text-display outline-none">Does this look right?</h1>
      <p className="mt-2 text-body text-muted">This is what we found. Fix anything that is off: matching and your outreach drafts are built from it.</p>

      <div className="mt-8 flex flex-col gap-5">
        <Field label="Name" error={errors.name}>
          <input
            className="h-11 w-full rounded-control border border-border-strong bg-surface px-3.5 text-body transition-[border-color,box-shadow] hover:border-ink/40 focus-visible:border-primary focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/15 aria-[invalid=true]:border-danger"
            value={profile.name}
            onChange={(e) => onChange({ ...profile, name: e.target.value })}
          />
        </Field>
        <Field label="Summary" error={errors.summary}>
          <Textarea value={profile.summary} onChange={(e) => onChange({ ...profile, summary: e.target.value })} />
        </Field>
        <Field label="Skills" hint="Add or remove skills. Press Enter after each.">
          <TagInput value={profile.skills} onChange={(v) => onChange({ ...profile, skills: v })} noun="skill" max={40} placeholder="Add a skill" />
        </Field>

        <dl className="grid gap-4 rounded-card border border-border bg-surface p-4 text-small sm:grid-cols-3">
          <Found label="Experience" count={profile.experience.length} items={profile.experience.map((x) => `${x.title}, ${x.company}`)} />
          <Found label="Projects" count={profile.projects.length} items={profile.projects.map((x) => x.name)} />
          <Found label="Education" count={profile.education.length} items={profile.education.map((x) => x.institution)} />
        </dl>

        <div className="rounded-card border border-border bg-surface p-4">
          <p className="text-small font-medium">Your search</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {prefs.roles.map((r) => <Chip key={r} tone="primary">{r}</Chip>)}
            {prefs.locations.map((l) => <Chip key={l}>{l}</Chip>)}
            {prefs.remote_ok && <Chip>Remote OK</Chip>}
            {prefs.experience_level && <Chip>{prefs.experience_level}</Chip>}
          </div>
          <p className="mt-2 text-caption text-muted">You can change these any time from your profile.</p>
        </div>

        {error && <p role="alert" className="rounded-control bg-danger-tint px-3.5 py-3 text-small font-medium text-danger-ink">{error}</p>}
      </div>

      <div className="mt-8 flex justify-end">
        <Button type="submit" size="lg" disabled={saving} magnetic>
          {saving ? <><Loader2 className="size-5 animate-spin" aria-hidden /> Saving...</> : <>Looks good, show my jobs <ArrowRight className="size-5" aria-hidden /></>}
        </Button>
      </div>
    </form>
  );
}

function Found({ label, count, items }: { label: string; count: number; items: string[] }) {
  return (
    <div>
      <dt className="font-medium">{label}</dt>
      <dd className="mt-1 text-muted">
        {count === 0 ? "None found" : (
          <>
            {count} found
            <ul className="mt-1 list-disc pl-4">
              {items.slice(0, 3).map((i) => <li key={i} className="truncate">{i}</li>)}
              {items.length > 3 && <li className="list-none text-caption">+{items.length - 3} more</li>}
            </ul>
          </>
        )}
      </dd>
    </div>
  );
}
