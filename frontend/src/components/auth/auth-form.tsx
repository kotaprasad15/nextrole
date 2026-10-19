"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/field";
import { ApiError } from "@/lib/api/client";
import { api } from "@/lib/api/endpoints";
import { safeNext } from "@/lib/route-guard";

/** Functional sign-in / sign-up. Milestone 3 restyles the surrounding page and adds richer validation. */
export function AuthForm({ mode }: { mode: "login" | "signup" }) {
  const router = useRouter();
  const params = useSearchParams();
  const qc = useQueryClient();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const submit = useMutation({
    mutationFn: () => (mode === "login" ? api.login(email.trim(), password) : api.signup(email.trim(), password)),
    onSuccess: () => {
      qc.clear();
      // New accounts have no profile yet, so they start in onboarding.
      router.replace(safeNext(params.get("next"), mode === "signup" ? "/onboarding" : "/dashboard"));
    },
  });

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    submit.mutate();
  };
  const error = submit.error instanceof ApiError ? submit.error.message : submit.error ? "Something went wrong." : undefined;
  const isLogin = mode === "login";

  return (
    <Card className="p-7">
      <h1 className="font-display text-display">{isLogin ? "Welcome back" : "Create your account"}</h1>
      <p className="mt-2 text-small text-muted">
        {isLogin ? "Log in to see your matches." : "Start with your resume. It takes about two minutes."}
      </p>
      <form onSubmit={onSubmit} className="mt-6 flex flex-col gap-4" noValidate>
        <Field label="Email">
          <Input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Password" hint={isLogin ? undefined : "At least 8 characters."}>
          <Input
            type="password"
            autoComplete={isLogin ? "current-password" : "new-password"}
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
        {error && (
          <p role="alert" className="text-small font-medium text-danger">
            {error}
          </p>
        )}
        <Button type="submit" size="lg" disabled={submit.isPending}>
          {submit.isPending ? "Please wait..." : isLogin ? "Log in" : "Create account"}
        </Button>
      </form>
      <p className="mt-6 text-center text-small text-muted">
        {isLogin ? "New to NextRole? " : "Already have an account? "}
        <Link href={isLogin ? "/signup" : "/login"} className="link-underline font-medium text-primary">
          {isLogin ? "Create an account" : "Log in"}
        </Link>
      </p>
    </Card>
  );
}
