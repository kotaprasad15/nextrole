"use client";

import { ChevronDown } from "lucide-react";
import {
  cloneElement,
  isValidElement,
  useId,
  type InputHTMLAttributes,
  type ReactElement,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { cn } from "@/lib/cn";

const control =
  "w-full rounded-control border border-border-strong bg-surface px-3.5 text-body text-ink " +
  "placeholder:text-muted/80 transition-[border-color,box-shadow] duration-150 " +
  "hover:border-ink/40 focus-visible:border-primary focus-visible:outline-none " +
  "focus-visible:ring-4 focus-visible:ring-primary/15 disabled:opacity-50 " +
  "aria-[invalid=true]:border-danger aria-[invalid=true]:focus-visible:ring-danger/15";

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(control, "h-11", className)} {...props} />;
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(control, "min-h-28 py-3 leading-6", className)} {...props} />;
}

/** Native select (best accessibility and mobile UX), styled to match. */
export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className="relative">
      <select className={cn(control, "h-11 appearance-none pr-10", className)} {...props}>
        {children}
      </select>
      <ChevronDown
        aria-hidden
        className="pointer-events-none absolute right-3.5 top-1/2 size-4 -translate-y-1/2 text-muted"
      />
    </div>
  );
}

/**
 * Label + control + hint + error, wired with ids and aria so screen readers announce the
 * label, hint and error. Pass exactly one control (Input, Textarea or Select) as the child.
 */
export function Field({
  label,
  hint,
  error,
  children,
  className,
}: {
  label: string;
  hint?: ReactNode;
  error?: string;
  children: ReactElement<{ id?: string; "aria-describedby"?: string; "aria-invalid"?: boolean }>;
  className?: string;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hint ? hintId : "", error ? errorId : ""].filter(Boolean).join(" ") || undefined;
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={id} className="text-small font-medium text-ink">
        {label}
      </label>
      {isValidElement(children) &&
        cloneElement(children, {
          id,
          "aria-describedby": describedBy,
          "aria-invalid": error ? true : undefined,
        })}
      {hint && !error && (
        <p id={hintId} className="text-caption text-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} role="alert" className="text-caption font-medium text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
