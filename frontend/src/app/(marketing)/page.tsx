import Link from "next/link";
import { Button } from "@/components/ui/button";

// Temporary placeholder: the real marketing homepage (scrollytelling) is milestone 9.
export default function Home() {
  return (
    <main id="main" className="page-container grid min-h-[70vh] place-items-center py-20">
      <div className="max-w-2xl text-center">
        <h1 className="font-display text-display-xl text-balance">Find the role. Write the email.</h1>
        <p className="mt-5 text-body-lg text-muted">
          Upload your resume, see real openings sorted by company type, and send outreach that sounds like you.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Button asChild size="lg" magnetic>
            <Link href="/signup">Get started</Link>
          </Button>
          <Button asChild size="lg" variant="secondary">
            <Link href="/design">Design system</Link>
          </Button>
        </div>
      </div>
    </main>
  );
}
