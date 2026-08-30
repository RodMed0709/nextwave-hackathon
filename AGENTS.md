# AGENTS.md — read this before touching anything

Instructions for coding agents (Codex, Claude Code, etc.) working in this repository.
The human-facing overview is [`readme.md`](readme.md); this file is the operational contract.

---

## The one rule that unblocks you

**Everything is deployed and live at `usedonald.com`. Never point anything at
`localhost`, `127.0.0.1`, or any other local backend — there is no local backend
and there never will be one for you.**

The database, the REST API, the SSE stream and the MCP server all run on the team's
own infrastructure and are reachable from anywhere, **with no authentication**:

| Surface | URL | What it serves |
|---|---|---|
| Web app | `https://usedonald.com/runs/<run_key>` | one run, watched live |
| REST API | `https://api.usedonald.com/v1/runs` | run list, newest first |
| Snapshot | `https://api.usedonald.com/v1/runs/<run_key>` | run + nodes + edges + `last_sequence` |
| Live stream | `https://api.usedonald.com/v1/runs/<run_key>/stream?after=N` | SSE deltas after a cursor |
| Interventions | `POST https://api.usedonald.com/v1/runs/<run_key>/interventions` | stop/steer — `{type, node_key?, prompt}` |
| MCP server | `https://mcp.usedonald.com/v1/mcp` | agent-facing, streamable HTTP, 13 tools |

Quick sanity check (should return `{"status":"OK"}`):

```sh
curl -s https://api.usedonald.com/healthz
```

The **frontend dev server** itself still runs on `localhost:3000` — that part is
normal Next.js. What must never be local is the **data**: the API base the app talks
to is always `https://api.usedonald.com`.

### Hard rule: never GENERATE localhost either

Do not write `localhost`, `127.0.0.1`, `0.0.0.0` or any local port as an API base,
MCP URL, database host, fetch target, env-var value, config default, doc example or
code comment — anywhere, ever. There is nothing running locally to point at. The only
acceptable localhost in this repo is the Next dev-server URL in human-facing run
instructions (`http://localhost:3000`).

**Before declaring any task done, run this over the files you touched and justify
every hit:**

```sh
git diff --name-only | xargs grep -n -i "localhost\|127\.0\.0\.1" --
```

If you catch yourself scaffolding a mock server, a local backend, a docker-compose
with a database, or an `.env` pointing anywhere but `https://api.usedonald.com` —
stop. The deployed stack IS the dev environment. Read/write it directly.

---

## How the frontend connects to the backend

One environment variable decides everything. In `frontend/components/donald/run-viewer.tsx`:

```ts
const API_BASE_URL = process.env.NEXT_PUBLIC_DONALD_API ?? null
// unset          → recordedSource(...)  (bundled JSONL fixtures)
// set            → liveSource(API_BASE_URL, runKey)  (snapshot + SSE)
```

`NEXT_PUBLIC_DONALD_API` is read from `frontend/.env.local`, which is **gitignored —
a fresh clone does not have it**. That is why the app "cannot connect" after cloning.
Fix it once:

```sh
cd frontend
cp .env.example .env.local     # sets NEXT_PUBLIC_DONALD_API=https://api.usedonald.com
npx pnpm@10 install
npx pnpm@10 dev                # on Windows PowerShell use npx.cmd, not npx
```

Behaviour once the variable is set:

- The three pitch runs — `missing-invoice`, `replan`, `land-pickup` — and the bare `/`
  route play from **bundled recordings** (`frontend/lib/donald/events.*.jsonl`) on
  purpose, so the pitch never depends on the network. The allowlist is
  `RECORDED_RUNS` in `run-viewer.tsx`.
- **Any other run key streams live** from the API and accepts interventions. Create a
  live run by having any MCP client call the tools at `https://mcp.usedonald.com/v1/mcp`
  (see [`skill/README.md`](skill/README.md)) — `start_run` returns a `watch_url` you
  can open immediately.

**All shape differences between backend payloads and what the UI wants are absorbed in
`frontend/lib/donald/source.ts` (the adapter) and `frontend/lib/donald/reduce.ts` (the
reducer). If a payload does not match, fix the adapter — never reshape the UI, and
never ask the backend to reshape events.**

---

## The database — you do not need credentials

The data lives in MySQL inside a microk8s cluster on the team's Linode box. You are
probably **not invited to nuzur** (the SaaS the backend is generated from) and you do
**not have the MySQL credentials** (they exist only in a root-only file on the box).
None of that blocks you:

- **Read anything** through the public REST API above — every table is exposed as
  generated CRUD in kebab-case (`/v1/agent-runs`, `/v1/agent-events`, `/v1/agent-nodes`,
  `/v1/agent-edges`, `/v1/interventions`, `/v1/artifacts`, `/v1/clients`), plus the
  curated `/v1/runs` endpoints above. No auth; the paging parameter is `page_size`,
  not `limit`. The full contract is served at `https://api.usedonald.com/v1/openapi.yaml`.
- **Write runs/events** through the public MCP endpoint — also no auth.
- Direct SQL access is SSH-only to the box and is not needed for frontend work. If you
  genuinely need it, ask Rodrigo.

`agent_event` is the source of truth (append-only, per-run monotonic `sequence`);
nodes and edges are materialised snapshots of it. Schema: `deploy/schema.sql`.

---

## The canonical demo case: Berríos OP-4471

**[`docs/berrios-op4471-case.md`](docs/berrios-op4471-case.md) is the single source of
truth for the pitch case.** Read it before touching anything Berríos-related. The short
version:

- Client: **Mueblerías Berríos — Puerto Rico** (real Nauta case study; the only real,
  attributable numbers are $3M/yr less demurrage and 65% less manual work).
- Model: **Above the Line** (Nina's ambient watch — ingest/identify/monitor, always on)
  hands off to **Below the Line** (triggered chain: DETECT → RECONCILE → EXPLAIN →
  IMPACT → PLAN → DECIDE → ACT) when MSC changes the vessel/routing on OP-4471.
- Named agents: **Nina** (Shipment Watch), **Theo** (Freight Anomaly), **Rex** (Root
  Cause), **Lex** (Expedite Communication). Do not invent others or reassign steps.
- The human gate sits at **DECIDE**, between Rex's PLAN and Lex's ACT.
- Run key `berrios-op4471`, recording generated by `scripts/gen-berrios-op4471.py` —
  **regenerate, never hand-edit the JSONL**.
- The spec's *"Real vs. illustrative"* section is load-bearing: never present an
  illustrative number as a published one.

`land-pickup` (BERU-40022) is an older, different Berríos case — regression material
only. Do not mix their numbers, steps or documents.

### UI work: the spec's per-step table is the roadmap

The *"Expected UI per step"* table in the case doc is the target for interface
improvements, in priority order:

| Step | Target render |
|---|---|
| ATL lane | persistent ambient strip — visible, quiet, never blocks |
| DETECT | trace line + alert banner that breaks the strip into a foreground flow |
| RECONCILE | old-booking vs new-schedule compare, mismatch highlighted |
| EXPLAIN | evidence list (root cause) |
| IMPACT | cost/time stat block |
| PLAN | ranked option cards |
| DECIDE | escalation panel only when gated; silent trace line otherwise |
| ACT | drafted email card, then confirmation once sent |
| return to ATL | foreground flow collapses back into the ambient strip |

Implementation lives in `frontend/lib/donald/operational-stages.ts`,
`frontend/lib/donald/action-presentation.ts` and
`frontend/components/donald/operational-stage.tsx`. Presentation is driven by data —
map event/action names to renders in those files, never hardcode run-specific
branches in components.

## Repository map

| Path | What it is | Can you edit it? |
|---|---|---|
| `frontend/` | Next 16 + React Flow. Graph layout computed from data, never hand-authored. | Yes — this is where UI work happens. Read `frontend/AGENTS.md` first. |
| `backend/donald/` | Go backend generated by nuzur + MCP server. | **Mostly no.** Generated files (entity/, enums/, core/, rest/, config/, main.go — listed in `.nuzur-codegen-manifest.json`) must not be edited. `app/` is the free zone. See `backend/donald/AI.md`. Backend changes also require a redeploy only Rodrigo can run. |
| `skill/` | The MCP skills a real agent reads (`donald-flow`, `nauta-operations`). | Yes, carefully — content drives the demo. |
| `deploy/` | Helm charts + scripts for the Linode box. | Coordinate with Rodrigo; you cannot deploy. |
| `nauta-dummy/` | Scenario briefs, regression material. | Yes. |

---

## House rules

1. **Never commit to `main`.** Work on a feature branch; a human merges.
2. Do not edit generated backend files (see table above).
3. No secrets, API keys or credentials in the repo — `.env.local` stays gitignored;
   only `.env.example` (public URLs) is committed.
4. Frontend verification gates, run before claiming anything works:
   ```sh
   cd frontend
   npx pnpm@10 exec tsc --noEmit
   npx pnpm@10 test
   npx pnpm@10 build
   ```
   (`npx.cmd` on Windows PowerShell.)
5. Recordings: new `.jsonl` fixtures are registered in the allowlist in
   `frontend/app/api/donald-recording/route.ts` — never join a query parameter onto a
   path. `events.recorded.jsonl` is read by tests; leave it alone, add files beside it.

---

## Current truth vs stale docs

`readme.md` (Status section) is the up-to-date picture: everything redeployed and live
on `usedonald.com`. **`HANDOFF.md` §1 is stale** — it describes an outage of the old
`todes.mx` deployment that has since been replaced; its house rules and scope tables
are still valid. `INTEGRATION.md` describes backend asks that were already fixed.
When docs disagree, trust `readme.md`, then this file, then the code.
