import Link from "next/link";
import { Button } from "@/components/ui/button";

// Temporary placeholder: the real marketing homepage (scrollytelling) is milestone 9.
export default function Home() {
  return (
    <main id="main" className="page-container grid min-h-screen place-items-center">
      <div className="max-w-xl text-center">
        <h1 className="font-display text-display-lg text-balance">NextRole</h1>
        <p className="mt-4 text-body-lg text-muted">
          The redesign is in progress. Explore the design system while the pages are built.
        </p>
        <Button asChild className="mt-8" size="lg">
          <Link href="/design">Open the design system</Link>
        </Button>
      </div>
    </main>
  );
}
