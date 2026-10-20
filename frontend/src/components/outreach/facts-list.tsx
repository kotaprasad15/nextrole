import { ExternalLink } from "lucide-react";
import type { Fact } from "@/lib/api/schemas";
import { safeSource } from "@/lib/outreach";

const GROUPS: { source: Fact["source"]; title: string }[] = [
  { source: "job", title: "From the posting" },
  { source: "research", title: "Company research" },
  { source: "profile", title: "From your profile" },
];

/**
 * The closed set of facts a draft may use, grouped by where they came from. Source links are
 * the URLs the backend recorded (https only); the model never writes them.
 */
export function FactsList({ facts }: { facts: Fact[] }) {
  return (
    <div className="flex flex-col gap-4">
      {GROUPS.map(({ source, title }) => {
        const items = facts.filter((f) => f.source === source);
        if (!items.length) return null;
        return (
          <div key={source}>
            <h4 className="text-small font-semibold">{title}</h4>
            <ul className="mt-1.5 flex flex-col gap-1.5">
              {items.map((f) => {
                const href = safeSource(f.source_ref);
                return (
                  <li key={f.id} className="text-small text-ink/85">
                    {f.text}{" "}
                    {href && (
                      <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 font-medium text-primary hover:underline">
                        source<ExternalLink className="size-3" aria-hidden />
                        <span className="sr-only"> (opens in a new tab)</span>
                      </a>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </div>
  );
}
