"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { PasswordInput } from "@/components/ui/password-input";
import { ApiError } from "@/lib/api/client";
import { api } from "@/lib/api/endpoints";
import { mapAuthError } from "@/lib/auth-errors";
import { safeNext } from "@/lib/route-guard";
import { fieldErrors, loginSchema, signupSchema, type FieldErrors } from "@/lib/validation";
import { PasswordStrength } from "./password-strength";

type Mode = "login" | "signup";
type Errors = FieldErrors<"email" | "password">;

const COPY = {
  login: { title: "Welcome back", sub: "Log in to see your matches.", cta: "Log in", pending: "Logging in...", altText: "New to NextRole?", altLink: "Create an account", altHref: "/signup" },
  signup: { title: "Create your account", sub: "Start with your resume. It takes about two minutes.", cta: "Create account", pending: "Creating account...", altText: "Already have an account?", altLink: "Log in", altHref: "/login" },
} as const;

/**
 * Sign in / sign up. Validates on blur and on submit (mirroring the backend rules), focuses the
 * first invalid field, maps server errors onto the right field, and routes the user onward:
 * new accounts go to onboarding; returning users go to where they were headed, or to onboarding
 * if they never finished it.
 */
export function AuthForm({ mode }: { mode: Mode }) {
  const router = useRouter();
  const params = useSearchParams();
  const qc = useQueryClient();
  const c = COPY[mode];
  const schema = mode === "login" ? loginSchema : signupSchema;

  const [values, setValues] = useState({ email: "", password: "" });
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string>();
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  const validateField = (name: "email" | "password", next = values) => {
    const result = schema.safeParse(next);
    const message = result.success ? undefined : fieldErrors<"email" | "password">(result.error)[name];
    setErrors((e) => ({ ...e, [name]: message }));
    return message;
  };

  const submit = useMutation({
    mutationFn: () => (mode === "login" ? api.login(values.email.trim(), values.password) : api.signup(values.email.trim(), values.password)),
    onSuccess: async () => {
      qc.clear();
      if (mode === "signup") return router.replace(safeNext(params.get("next"), "/onboarding"));
      // Returning user: if they never completed onboarding, finish that first.
      const hasProfile = await api.profile().then(() => true, (e) => !(e instanceof ApiError && e.status === 404));
      router.replace(hasProfile ? safeNext(params.get("next")) : "/onboarding");
    },
    onError: (err) => {
      const mapped = mapAuthError(mode, err);
      if (mapped.field) {
        setErrors((e) => ({ ...e, [mapped.field!]: mapped.message }));
        (mapped.field === "email" ? emailRef : passwordRef).current?.focus();
      } else setFormError(mapped.message);
    },
  });

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    setFormError(undefined);
    const result = schema.safeParse(values);
    if (!result.success) {
      const errs = fieldErrors<"email" | "password">(result.error);
      setErrors(errs);
      (errs.email ? emailRef : passwordRef).current?.focus(); // first invalid field
      return;
    }
    setErrors({});
    submit.mutate();
  };

  return (
    <div>
      <h1 className="font-display text-display">{c.title}</h1>
      <p className="mt-2 text-body text-muted">{c.sub}</p>

      <form onSubmit={onSubmit} noValidate className="mt-8 flex flex-col gap-5">
        <Field label="Email" error={errors.email}>
          <Input
            ref={emailRef}
            type="email"
            name="email"
            autoComplete="email"
            inputMode="email"
            spellCheck={false}
            value={values.email}
            onChange={(e) => {
              setValues((v) => ({ ...v, email: e.target.value }));
              if (errors.email) setErrors((er) => ({ ...er, email: undefined }));
            }}
            onBlur={() => values.email && validateField("email")}
          />
        </Field>

        <Field label="Password" error={errors.password} hint={mode === "signup" ? "At least 8 characters." : undefined}>
          <PasswordInput
            ref={passwordRef}
            name="password"
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            value={values.password}
            onChange={(e) => {
              setValues((v) => ({ ...v, password: e.target.value }));
              if (errors.password) setErrors((er) => ({ ...er, password: undefined }));
            }}
            onBlur={() => mode === "signup" && values.password && validateField("password")}
          />
        </Field>
        {mode === "signup" && <PasswordStrength password={values.password} />}

        {formError && (
          <p role="alert" className="rounded-control bg-danger-tint px-3.5 py-3 text-small font-medium text-danger-ink">
            {formError}
          </p>
        )}

        <Button type="submit" size="lg" disabled={submit.isPending} magnetic>
          {submit.isPending ? (
            <>
              <Loader2 className="size-5 animate-spin" aria-hidden /> {c.pending}
            </>
          ) : (
            c.cta
          )}
        </Button>
      </form>

      <p className="mt-6 text-center text-small text-muted">
        {c.altText}{" "}
        <Link href={{ pathname: c.altHref, query: params.get("next") ? { next: params.get("next") } : undefined }} className="link-underline font-medium text-primary">
          {c.altLink}
        </Link>
      </p>

      <p className="mt-8 flex items-start gap-2 rounded-control border border-border bg-surface px-3.5 py-3 text-caption text-muted">
        <ShieldCheck className="mt-px size-4 shrink-0 text-success-ink" aria-hidden />
        Your resume is stored encrypted, and you can delete everything at any time. NextRole never sends a message on your behalf.
      </p>
    </div>
  );
}
