<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Donald frontend — how it connects

**Read the root [`AGENTS.md`](../AGENTS.md) first.** Short version:

- The backend is live at `https://api.usedonald.com` — **never use `localhost` or
  `127.0.0.1` as an API base**; there is no local backend.
- The app reads `NEXT_PUBLIC_DONALD_API` from `.env.local`, which is gitignored.
  After cloning: `cp .env.example .env.local`, then `npx pnpm@10 install && npx pnpm@10 dev`
  (`npx.cmd` on Windows PowerShell).
- With the variable unset, everything plays from bundled JSONL recordings — the UI
  works but nothing is live. With it set, the keys `missing-invoice`, `replan` and
  `land-pickup` (and `/`) still replay recordings by design; **every other run key
  streams live** via snapshot + SSE and accepts interventions.
- Payload-shape differences are absorbed in `lib/donald/source.ts` (adapter) and
  `lib/donald/reduce.ts` (reducer). Fix mismatches there — do not reshape components,
  do not ask the backend to change its events.
- Gates before claiming done: `npx pnpm@10 exec tsc --noEmit`, `npx pnpm@10 test`,
  `npx pnpm@10 build`.

## The case you are building for

The pitch case is **Berríos OP-4471** — spec at
[`../docs/berrios-op4471-case.md`](../docs/berrios-op4471-case.md), run key
`berrios-op4471` (the default run). Its *"Expected UI per step"* table is the roadmap
for interface work; the root `AGENTS.md` repeats it with the file map. Rules:

- Presentation is data-driven: map action/event names in `lib/donald/operational-stages.ts`
  and `lib/donald/action-presentation.ts`. Never hardcode run-specific branches in
  components.
- Recordings are generated (`../scripts/gen-berrios-op4471.py`) — never hand-edit a
  `.jsonl`.
- Never generate `localhost`/`127.0.0.1` as any API base, env value or example — the
  deployed API is the dev environment. Full rule in the root `AGENTS.md`.
- Verify visually against `http://localhost:3000/runs/berrios-op4471` (recorded, works
  offline) and against a live key streamed from `api.usedonald.com`.
