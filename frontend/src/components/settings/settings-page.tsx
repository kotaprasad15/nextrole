"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useTheme } from "next-themes";
import { useRouter } from "next/navigation";
import { useState, useSyncExternalStore, type ReactNode } from "react";
import { PageHeader } from "@/components/shell/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { RadioCards } from "@/components/ui/radio-cards";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import { ApiError } from "@/lib/api/client";
import { api } from "@/lib/api/endpoints";
import { useLogout, useMe } from "@/lib/api/queries";
import { useDisplayPrefs } from "@/lib/local/display-prefs";
import { clearLocalData } from "@/lib/local/clear";
import { useSystemReducedMotion } from "@/lib/motion/hooks";

export const DELETE_PHRASE = "delete";

function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="flex flex-col gap-4">
      <div>
        <h2 className="text-h2 font-semibold tracking-tight">{title}</h2>
        {description && <p className="mt-1 text-small text-muted">{description}</p>}
      </div>
      {children}
    </section>
  );
}

/** Account, display preferences, privacy facts, and the way to delete everything. */
export function SettingsPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const me = useMe();
  const logout = useLogout();
  const { prefs, set } = useDisplayPrefs();
  const { theme, setTheme } = useTheme();
  // The stored theme is only known in the browser: show "system" until hydrated so server and client match.
  const hydrated = useSyncExternalStore(() => () => {}, () => true, () => false);
  const systemReduced = useSystemReducedMotion();
  const [confirm, setConfirm] = useState<"local" | "delete" | null>(null);
  const [phrase, setPhrase] = useState("");
  const [alsoLocal, setAlsoLocal] = useState(true);

  const remove = useMutation({
    mutationFn: () => api.deleteAccount(),
    onSuccess: async () => {
      if (alsoLocal) clearLocalData();
      // The session cookie is HttpOnly: ask the server to clear it, then leave.
      await api.logout().catch(() => {});
      qc.clear();
      toast("Your account and data were deleted");
      router.replace("/");
    },
  });

  const close = () => {
    setConfirm(null);
    setPhrase("");
    remove.reset();
  };

  return (
    <>
      <PageHeader eyebrow="Settings" title="Account and preferences" description="How NextRole looks and behaves for you, what it keeps, and how to delete it." />
      <div className="flex max-w-3xl flex-col gap-12">
        <Section title="Account">
          <Card className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-small text-muted">Signed in as</p>
              {me.isPending ? <Skeleton className="mt-1 h-6 w-56" /> : <p className="font-medium">{me.data?.email ?? "Unknown"}</p>}
            </div>
            <Button variant="secondary" disabled={logout.isPending} onClick={() => logout.mutate(undefined, { onSettled: () => router.replace("/") })}>
              {logout.isPending && <Loader2 className="size-4 animate-spin" aria-hidden />} Log out
            </Button>
          </Card>
        </Section>

        <Section title="Display" description="Saved in this browser.">
          <fieldset>
            <legend className="mb-2 text-small font-medium">Theme</legend>
            <RadioCards
              label="Theme"
              value={hydrated ? (theme ?? "system") : "system"}
              onValueChange={setTheme}
              options={[
                { value: "system", label: "Match my device", hint: "Light or dark, following your system setting." },
                { value: "light", label: "Light", hint: "Warm paper background." },
                { value: "dark", label: "Dark", hint: "Deep neutral background, easier at night." },
              ]}
              className="sm:grid-cols-3"
            />
          </fieldset>
          <fieldset>
            <legend className="mb-2 text-small font-medium">Motion</legend>
            <RadioCards
              label="Motion"
              value={prefs.motion}
              onValueChange={(v) => set({ motion: v as "system" | "reduced" })}
              options={[
                { value: "system", label: "Follow my device", hint: "Use the reduced-motion setting from your system." },
                { value: "reduced", label: "Always reduce motion", hint: "No animations or tilt, and no scroll story on the homepage." },
              ]}
            />
            {systemReduced && <p className="mt-2 text-small text-muted">Your device already asks for reduced motion, so motion stays off whichever you pick.</p>}
          </fieldset>
        </Section>

        <Section title="Privacy and your data">
          <Card className="flex flex-col gap-5">
            <div>
              <CardTitle as="h3">What is stored on the server (your account)</CardTitle>
              <CardDescription className="mt-1">Your profile, your resume file (encrypted), your matches, your outreach drafts and feedback notes, and your run history. Deleting your account removes all of it.</CardDescription>
            </div>
            <div>
              <CardTitle as="h3">What is stored only in this browser</CardTitle>
              <CardDescription className="mt-1">Saved jobs, the application tracker, draft version history and these display settings. They never leave this device and are not backed up.</CardDescription>
              <Button variant="secondary" size="sm" className="mt-3" onClick={() => setConfirm("local")}>Clear data stored in this browser</Button>
            </div>
            <div>
              <CardTitle as="h3">The AI model provider</CardTitle>
              <CardDescription className="mt-1">To build your profile, score jobs and write drafts, your resume text and job postings are sent to the AI model provider this NextRole is set up with. Ask whoever runs your instance which provider that is. Drafts are never sent to anyone for you.</CardDescription>
            </div>
          </Card>
        </Section>

        <Section title="Delete my account">
          <Card className="border-danger/25">
            <p className="text-small text-ink/85">This permanently deletes your account, profile, resume file, matches, drafts and run history. It cannot be undone.</p>
            <Button variant="danger" className="mt-4" onClick={() => setConfirm("delete")}>Delete my account and data</Button>
          </Card>
        </Section>
      </div>

      <Modal
        open={confirm === "local"}
        onOpenChange={(o) => !o && close()}
        title="Clear data in this browser?"
        description="Saved jobs, the tracker and draft version history on this device will be removed. Your account is not affected."
        footer={
          <>
            <Button variant="ghost" onClick={close}>Cancel</Button>
            <Button variant="danger" onClick={() => { clearLocalData(); toast("Browser data cleared", { variant: "success" }); close(); }}>Clear it</Button>
          </>
        }
      />

      <Modal
        open={confirm === "delete"}
        onOpenChange={(o) => !o && close()}
        title="Delete your account?"
        description="Everything stored for you on the server is removed for good."
      >
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (phrase.trim().toLowerCase() === DELETE_PHRASE) remove.mutate();
          }}
        >
          <Field label={`Type "${DELETE_PHRASE}" to confirm`}>
            <Input value={phrase} onChange={(e) => setPhrase(e.target.value)} autoComplete="off" autoCapitalize="none" spellCheck={false} />
          </Field>
          <label className="flex items-start gap-2.5 text-small">
            <input type="checkbox" checked={alsoLocal} onChange={(e) => setAlsoLocal(e.target.checked)} className="mt-0.5 size-4 accent-primary" />
            Also clear saved jobs, the tracker and draft history stored in this browser
          </label>
          {remove.error && <p role="alert" className="rounded-control bg-danger-tint px-3.5 py-3 text-small font-medium text-danger-ink">{remove.error instanceof ApiError ? remove.error.message : "Could not delete your account. Please try again."}</p>}
          <div className="flex justify-end gap-3">
            <Button type="button" variant="ghost" onClick={close}>Cancel</Button>
            <Button type="submit" variant="danger" disabled={phrase.trim().toLowerCase() !== DELETE_PHRASE || remove.isPending}>
              {remove.isPending && <Loader2 className="size-4 animate-spin" aria-hidden />} Delete everything
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
