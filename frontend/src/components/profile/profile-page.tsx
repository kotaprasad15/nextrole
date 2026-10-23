"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Pencil, UserRound } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { PageHeader } from "@/components/shell/page-header";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Modal } from "@/components/ui/modal";
import { ErrorState } from "@/components/ui/error-state";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "@/components/ui/toast";
import { ApiError } from "@/lib/api/client";
import { api } from "@/lib/api/endpoints";
import { keys } from "@/lib/api/queries";
import type { Profile } from "@/lib/api/schemas";
import { cleanProfile, errorTab, isDirty, validateProfile, type ProfileErrors } from "@/lib/profile-form";
import { PreferencesSection, ProfileSections } from "./profile-sections";
import { RoleReading, WatchedCompanies } from "./watch-section";

type Tab = "profile" | "preferences";

/** `/profile`: the parsed profile and search preferences (saved to the account) and the companies to watch. */
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
      <PageHeader eyebrow="Profile" title="You, as we see you" description="What matching and your outreach drafts are built from. Saved jobs live on their own page." />
      {body}
    </>
  );
}

function ProfileTabs({ profile }: { profile: Profile }) {
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>("profile");
  const [draft, setDraft] = useState<Profile>(profile);
  const [errors, setErrors] = useState<ProfileErrors>({});
  // View mode is the default: every field is read-only until the user chooses Edit.
  const [editing, setEditing] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);

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
      setEditing(false);
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

  const startEditing = () => setEditing(true);
  const stopEditing = () => {
    setDraft(profile);
    setErrors({});
    setEditing(false);
    setConfirmCancel(false);
  };
  // Cancel with nothing changed just leaves edit mode; with changes it asks first.
  const onCancel = () => (dirty ? setConfirmCancel(true) : stopEditing());
  const formTab = tab === "profile" || tab === "preferences";

  const errorCount = Object.keys(errors).length;

  return (
    <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
      <TabsList aria-label="Profile sections">
        <TabsTrigger value="profile">Profile</TabsTrigger>
        <TabsTrigger value="preferences">Preferences</TabsTrigger>
      </TabsList>

      {formTab && !editing && (
        <div className="mt-6 flex items-center justify-between gap-3">
          <p className="text-small text-muted">This is what matching and your drafts use. Choose Edit to change it.</p>
          <Button onClick={startEditing}><Pencil className="size-4" aria-hidden /> Edit profile</Button>
        </div>
      )}
      {/* A disabled fieldset makes every control inside read-only at once (inputs, buttons, Radix switches). */}
      <TabsContent value="profile">
        <fieldset disabled={!editing} data-readonly={!editing} className="min-w-0"><legend className="sr-only">Profile details</legend><ProfileSections draft={draft} onChange={setDraft} errors={errors} /></fieldset>
      </TabsContent>
      <TabsContent value="preferences">
        <fieldset disabled={!editing} data-readonly={!editing} className="min-w-0"><legend className="sr-only">Search preferences</legend><PreferencesSection draft={draft} onChange={setDraft} errors={errors} /></fieldset>
        <div className="mt-6"><RoleReading roles={draft.preferences.roles} /></div>
        <WatchedCompanies />
      </TabsContent>

      {editing && formTab && (
        <div role="region" aria-label="Unsaved changes" className="sticky bottom-4 z-30 mt-8 flex flex-wrap items-center justify-between gap-3 rounded-card border border-border bg-surface p-4 shadow-3">
          <div>
            <p className="text-small font-semibold">{errorCount > 0 ? `Fix ${errorCount} ${errorCount === 1 ? "field" : "fields"} to save` : dirty ? "You have unsaved changes" : "Editing your profile"}</p>
            {save.error && <p role="alert" className="text-caption font-medium text-danger">{save.error instanceof ApiError ? save.error.message : "Could not save. Please try again."}</p>}
          </div>
          <div className="flex gap-3">
            <Button variant="ghost" onClick={onCancel}>Cancel</Button>
            <Button onClick={onSave} disabled={save.isPending || !dirty}>
              {save.isPending && <Loader2 className="size-4 animate-spin" aria-hidden />} Save changes
            </Button>
          </div>
        </div>
      )}
      <Modal
        open={confirmCancel}
        onOpenChange={setConfirmCancel}
        title="Discard your changes?"
        description="You have edits that are not saved. Cancelling throws them away."
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmCancel(false)}>Keep editing</Button>
            <Button variant="danger" onClick={stopEditing}>Discard changes</Button>
          </>
        }
      />
    </Tabs>
  );
}
