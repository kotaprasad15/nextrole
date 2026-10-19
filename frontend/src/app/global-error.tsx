"use client";

// Last-resort boundary (errors in the root layout itself). It replaces the whole document, so it
// must render <html>/<body> and cannot rely on providers, fonts or Tailwind variables.
export default function GlobalError({ retry }: { error: unknown; retry: () => void }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", background: "#faf8f5", color: "#14161a", display: "grid", placeItems: "center", minHeight: "100vh", margin: 0 }}>
        <div role="alert" style={{ textAlign: "center", padding: 24 }}>
          <h1 style={{ fontSize: 24 }}>NextRole hit an unexpected problem</h1>
          <p style={{ color: "#6b7280" }}>Reloading usually fixes it.</p>
          <button onClick={() => retry()} style={{ marginTop: 16, padding: "10px 20px", borderRadius: 10, border: 0, background: "#4f46e5", color: "#fff", fontSize: 16, cursor: "pointer" }}>
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
