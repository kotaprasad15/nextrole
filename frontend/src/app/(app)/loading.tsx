import { Skeleton } from "@/components/ui/skeleton";

/** Route-level loading UI (also the Suspense boundary Cache Components needs for dynamic pages). */
export default function Loading() {
  return (
    <div role="status" aria-label="Loading page">
      <Skeleton className="mb-3 h-4 w-28" />
      <Skeleton className="mb-3 h-11 w-2/3 max-w-lg" />
      <Skeleton className="mb-10 h-5 w-1/2 max-w-md" />
      <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-56 rounded-card" />
        ))}
      </div>
      <span className="sr-only">Loading</span>
    </div>
  );
}
