"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, UserRound } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { PageHeader } from "@/components/shell/page-header";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "@/components/ui/toast";
import { ApiError } from "@/lib/api/client";
import { api } from "@/lib/api/endpoints";
import { keys } from "@/lib/api/queries";
import type { Profile } from "@/lib/api/schemas";
import { useSavedJobs } from "@/lib/local/saved-jobs";
import { useTracker } from "@/lib/local/tracker";
import { cleanProfile, errorTab, isDirty, validateProfile, type ProfileErrors } from "@/lib/profile-form";
import { SavedJobs } from "./saved-jobs";
import { PreferencesSection, ProfileSections } from "./profile-sections";
import { TrackerBoard } from "./tracker-board";

type Tab = "profile" | "preferences" | "saved" | "tracker";

/** `/profile`: the parsed profile and search preferences (saved to the account), plus the local saved jobs and tracker. */
export function ProfilePage() {
  const q = useQuery({ queryKey: keys.profile, queryFn: api.profile });
  const notOnboarded = q.error instanceof ApiError && q.error.status === 404;

  let body;
  if (q.isPending) body = <div role="status" aria-label="Loading profile" className="flex flex-col gap-4"><Skeleton className="h-12 w-96" /><Skeleton className="h-72 rounded-card" /></div>;
  else if (notOnboarded) {
    body = (
      <EmptyState icon={<UserRound />} title="Finish setting up your profile" description="Upload your resume and tell us what you are looking for." action={<Button asChild><Link href="/onboarding">Start setup</Link></Button>} />
    );
  } else if (q.error) body = <ErrorState title="Could not load your profile" message={q.error.message} onRetry={() => q.refetch()} />;
  else body = <ProfileTabs profile={q.data} />;

  return (
    <>
      <PageHeader eyebrow="Profile" title="You, as we see you" description="What matching and your outreach drafts are built from. Saved jobs and the tracker live here too." />
      {body}
    </>
  );
}

function ProfileTabs({ profile }: { profile: Profile }) {
  const qc = useQueryClient();
  const savedJobs = useSavedJobs();
  const tracker = useTracker();
  const [tab, setTab] = useState<Tab>("profile");
  const [draft, setDraft] = useState<Profile>(profile);
  const [errors, setErrors] = useState<ProfileErrors>({});

  // The saved profile changed under us (after a save): adopt it. Derived state, adjusted in render.
  const sig = JSON.stringify(profile);
  const [seen, setSeen] = useState(sig);
  if (seen !== sig) {
    setSeen(sig);
    setDraft(profile);
    setErrors({});
  }

  const dirty = isDirty(draft, profile);
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);

  const save = useMutation({
    mutationFn: (p: Profile) => api.saveProfile(p),
    onSuccess: (p) => {
      qc.setQueryData(keys.profile, p);
      toast("Profile saved", { description: "New searches will use it.", variant: "success" });
    },
  });

  const onSave = () => {
    const cleaned = cleanProfile(draft);
    const errs = validateProfile(cleaned);
    setErrors(errs);
    const where = errorTab(errs);
    if (where) return setTab(where);
    save.mutate(cleaned);
  };

  const trackedIds = new Set(tracker.jobs.map((j) => j.id));
  const trackerCount = tracker.jobs.length + [...savedJobs.ids].filter((id) => !trackedIds.has(id)).length;
  const errorCount = Object.keys(errors).length;

  return (
    <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
      <TabsList aria-label="Profile sections">
        <TabsTrigger value="profile">Profile</TabsTrigger>
        <TabsTrigger value="preferences">Preferences</TabsTrigger>
        <TabsTrigger value="saved">Saved jobs <span className="tabular-nums text-muted">({savedJobs.ids.size})</span></TabsTrigger>
        <TabsTrigger value="tracker">Tracker <span className="tabular-nums text-muted">({trackerCount})</span></TabsTrigger>
      </TabsList>

      <TabsContent value="profile"><ProfileSections draft={draft} onChange={setDraft} errors={errors} /></TabsContent>
      <TabsContent value="preferences"><PreferencesSection draft={draft} onChange={setDraft} errors={errors} /></TabsContent>
      <TabsContent value="saved"><SavedJobs /></TabsContent>
      <TabsContent value="tracker"><TrackerBoard /></TabsContent>

      {(dirty || errorCount > 0) && (tab === "profile" || tab === "preferences") && (
        <div role="region" aria-label="Unsaved changes" className="sticky bottom-4 z-30 mt-8 flex flex-wrap items-center justify-between gap-3 rounded-card border border-border bg-surface p-4 shadow-3">
          <div>
            <p className="text-small font-semibold">{errorCount > 0 ? `Fix ${errorCount} ${errorCount === 1 ? "field" : "fields"} to save` : "You have unsaved changes"}</p>
            {save.error && <p role="alert" className="text-caption font-medium text-danger">{save.error instanceof ApiError ? save.error.message : "Could not save. Please try again."}</p>}
          </div>
          <div className="flex gap-3">
            <Button variant="ghost" onClick={() => { setDraft(profile); setErrors({}); }}>Discard</Button>
            <Button onClick={onSave} disabled={save.isPending || !dirty}>
              {save.isPending && <Loader2 className="size-4 animate-spin" aria-hidden />} Save changes
            </Button>
          </div>
        </div>
      )}
    </Tabs>
  );
}
