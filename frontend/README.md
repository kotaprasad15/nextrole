# NextRole frontend

Next.js (App Router) + TypeScript + Tailwind v4. The "Paper & Ink" redesign of the NextRole UI.
The FastAPI backend is unchanged; see the repo root `CLAUDE.md` for conventions.

```bash
npm install
npm run dev -- -p 3100   # http://localhost:3100  (style guide at /design)
npm test                 # Vitest (includes WCAG contrast checks on the design tokens)
npm run typecheck && npm run lint
npm run build            # production build
```
