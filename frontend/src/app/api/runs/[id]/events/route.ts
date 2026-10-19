/**
 * Streaming proxy for run events (Server-Sent Events). A plain rewrite can buffer a long-lived
 * response, so this handler pipes the backend's stream through unchanged: same body, no
 * buffering, and the browser's session cookie forwarded. Aborting the browser request aborts the
 * upstream one (via req.signal), so closed tabs do not leave dangling connections.
 */
const BACKEND_URL = process.env.BACKEND_URL ?? "http://127.0.0.1:8000";

export async function GET(req: Request, ctx: RouteContext<"/api/runs/[id]/events">) {
  const { id } = await ctx.params;
  const upstream = await fetch(`${BACKEND_URL}/runs/${encodeURIComponent(id)}/events`, {
    headers: { cookie: req.headers.get("cookie") ?? "", accept: "text/event-stream" },
    signal: req.signal,
    cache: "no-store",
  });
  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      "content-type": upstream.headers.get("content-type") ?? "text/event-stream",
      "cache-control": "no-cache, no-transform",
      "x-accel-buffering": "no",
    },
  });
}
