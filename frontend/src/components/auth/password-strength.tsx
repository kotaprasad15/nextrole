import { cn } from "@/lib/cn";
import { passwordStrength } from "@/lib/validation";

const COLORS = ["bg-border", "bg-danger", "bg-warning", "bg-success"];

/** Advisory strength meter. Colour is never the only signal: the label is real text. */
export function PasswordStrength({ password }: { password: string }) {
  const { level, label } = passwordStrength(password);
  if (!level) return null;
  return (
    <div className="mt-1" aria-live="polite">
      <div className="flex gap-1.5" aria-hidden>
        {[1, 2, 3].map((i) => (
          <span key={i} className={cn("h-1 flex-1 rounded-full transition-colors duration-200", i <= level ? COLORS[level] : "bg-border")} />
        ))}
      </div>
      <p className="mt-1.5 text-caption text-muted">
        Password strength: <span className="font-medium text-ink">{label}</span>
      </p>
    </div>
  );
}
