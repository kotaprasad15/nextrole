// Read-only contract check: every route the frontend calls must exist (same method) in the
// running backend's OpenAPI document. Usage: BACKEND_URL=http://127.0.0.1:8000 npm run check:api
import { ENDPOINTS } from "../src/lib/api/routes.ts";

const base = process.env.BACKEND_URL ?? "http://127.0.0.1:8000";
let spec;
try {
  spec = await (await fetch(`${base}/openapi.json`)).json();
} catch (err) {
  console.error(`Cannot reach ${base}/openapi.json (is the backend running?): ${err.message}`);
  process.exit(2);
}

const missing = ENDPOINTS.filter((e) => !spec.paths?.[e.path]?.[e.method.toLowerCase()]);
for (const e of ENDPOINTS) {
  const ok = !missing.includes(e);
  console.log(`${ok ? "ok     " : "MISSING"} ${e.method.padEnd(6)} ${e.path}`);
}
if (missing.length) {
  console.error(`\n${missing.length} route(s) the frontend calls are not in the backend OpenAPI.`);
  process.exit(1);
}
console.log(`\nAll ${ENDPOINTS.length} routes exist in the backend.`);
