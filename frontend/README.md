# NextRole frontend

Next.js (App Router) + TypeScript + Tailwind v4. The "Paper & Ink" UI of NextRole, and the only
one: FastAPI serves just the API. See the repo root `CLAUDE.md` for conventions.

It talks to the backend through a same-origin proxy (`/api/*` -> `BACKEND_URL`, default
`http://127.0.0.1:8000`), so start the backend first (`uv run uvicorn nextrole.api.main:app --reload`
from the repo root). Set `NEXT_PUBLIC_API_MODE=mock` in `.env.local` for sample data without a backend.

```bash
cp .env.example .env.local
npm install
npm run dev -- -p 3100   # http://127.0.0.1:3100  (style guide at /design)
npm test                 # Vitest (includes WCAG contrast checks on the design tokens)
npm run typecheck && npm run lint
npm run build            # production build
```
