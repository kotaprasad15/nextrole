import { Check, Circle } from "lucide-react";
import { cn } from "@/lib/cn";
import { PASSWORD_RULES } from "@/lib/validation";

/**
 * Live password rules. Met/unmet is stated in text ("met"/"not met", visually hidden) as well as by
 * icon and colour, and the list is announced politely as it changes.
 */
export function PasswordChecklist({ password, id }: { password: string; id?: string }) {
  return (
    <ul id={id} aria-label="Password requirements" aria-live="polite" className="-mt-2 grid gap-1.5 sm:grid-cols-2">
      {PASSWORD_RULES.map((r) => {
        const ok = r.test(password);
        return (
          <li key={r.id} data-met={ok} className={cn("flex items-center gap-2 text-caption", ok ? "text-success-ink" : "text-muted")}>
            {ok ? <Check className="size-3.5 shrink-0" aria-hidden /> : <Circle className="size-3.5 shrink-0" aria-hidden />}
            <span>{r.label}</span>
            <span className="sr-only">{ok ? "met" : "not met"}</span>
          </li>
        );
      })}
    </ul>
  );
}
