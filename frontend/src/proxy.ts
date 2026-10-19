import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/lib/api/config";
import { guard } from "@/lib/route-guard";

/** Auth guard (Next 16 `proxy`, formerly `middleware`). Rules live in lib/route-guard.ts. */
export function proxy(request: NextRequest) {
  const result = guard(request.nextUrl.pathname, request.cookies.has(SESSION_COOKIE));
  if (result.action === "redirect") return NextResponse.redirect(new URL(result.to, request.url));
  return NextResponse.next();
}

// Skip the API proxy, Next internals and any file with an extension (images, fonts, etc.).
export const config = { matcher: ["/((?!api|_next|.*\\..*).*)"] };
