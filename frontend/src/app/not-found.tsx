import Link from "next/link";
import { Button } from "@/components/ui/button";

export const metadata = { title: "Page not found" };

export default function NotFound() {
  return (
    <main id="main" className="page-container grid min-h-screen place-items-center py-16 text-center">
      <div className="max-w-md">
        <p className="font-display text-display-xl text-primary">404</p>
        <h1 className="mt-2 font-display text-display">That page does not exist</h1>
        <p className="mt-4 text-body-lg text-muted">
          The link may be old, or the job may have been removed from your matches.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Button asChild>
            <Link href="/dashboard">Go to dashboard</Link>
          </Button>
          <Button asChild variant="secondary">
            <Link href="/">Back to home</Link>
          </Button>
        </div>
      </div>
    </main>
  );
}
