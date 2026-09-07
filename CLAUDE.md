# AGENTS.md — read this before touching anything

Instructions for coding agents (Codex, Claude Code, etc.) working in this repository.
The human-facing overview is [`readme.md`](readme.md); this file is the operational contract.

---

## The one rule that unblocks you

**The demo is a Vercel deployment with no backend, and that is deliberate.**
`usedonald.com` serves `frontend/` with `NEXT_PUBLIC_DONALD_API` unset, so every run key
falls back to a bundled JSONL recording. Nothing to boot, nothing that can be down.

**The previously hosted backend is GONE.** `api.usedonald.com`, `mcp.usedonald.com` and
`connect.usedonald.com` no longer resolve — the DNS records were deleted on 7 Sep 2026 along
with the Cloudflare Tunnel that served them. Do not fetch them, do not write them into code,
docs or env files, and do not tell anyone to curl them.

| Surface | Status |
|---|---|
| `https://usedonald.com` and `/runs/<run_key>` | **live on Vercel**, recordings only |
| `https://usedonald.vercel.app` | same deployment, direct alias |
| `api.usedonald.com` · `mcp.usedonald.com` | **deleted** — no DNS, no host, no cert |

So: **for frontend work you need no backend at all.** `npx pnpm@10 dev` and the five recorded
runs play. That is the whole setup.

### If you genuinely need the live path

The Go API, the MCP server and the MySQL schema are all still in this repo and still work —
they are simply not hosted by anyone right now. `readme.md` §*Self-hosting the live stack* has
the recipe: `backend/donald/Dockerfile` run twice (`DONALD_ROLE=api` and `DONALD_ROLE=mcp`),
`deploy/schema.sql` into a MySQL, `deploy/prod.yaml.example` as the config template, then set
`NEXT_PUBLIC_DONALD_API` to wherever you put the API.

**Ask Rodrigo before standing any of that up.** It costs money and it is not needed for the
work that actually happens in this repo.

### Hard rule: still do not scatter localhost around

The reason this rule existed has changed, but the rule has not. Do not write `localhost`,
`127.0.0.1` or `0.0.0.0` as an API base, MCP URL, database host, fetch target, env-var value,
config default, doc example or code comment. The only acceptable local URLs are the **Next
dev-server** (`http://localhost:3000`) in human-facing run instructions, and whatever a
self-host recipe legitimately needs.

Above all: **do not scaffold a mock server, a fake backend, or a docker-compose with a
database to "unblock" yourself.** The recordings already unblock you.

Before declaring any task done, run this over the files you touched and justify every hit:

```sh
git diff --name-only | xargs grep -n -i "localhost\|127\.0\.0\.1" --
```

---


## How the frontend connects to its data

One environment variable decides everything. In `frontend/components/donald/run-viewer.tsx`:

```ts
const API_BASE_URL = process.env.NEXT_PUBLIC_DONALD_API ?? null
// unset          → recordedSource(...)  (bundled JSONL fixtures)
// set            → liveSource(API_BASE_URL, runKey)  (snapshot + SSE)
```

`NEXT_PUBLIC_DONALD_API` is read from `frontend/.env.local`, which is **gitignored**. A fresh
clone does not have it, **and does not need it** — that is the supported path:

```sh
cd frontend
npx pnpm@10 install
npx pnpm@10 dev                # on Windows PowerShell use npx.cmd, not npx
```

With the variable unset, **every** run key plays from a bundled recording and the app is fully
functional offline. Do not "fix" this by inventing an API base.

Behaviour if someone does set it to a self-hosted API:

- The five pitch runs — `missing-invoice`, `replan`, `land-pickup`, `berrios-op4471`,
  `berrios-op4471-v2` — and the bare `/` route still play from **bundled recordings**
  (`frontend/lib/donald/events.*.jsonl`) on purpose, so the pitch never depends on the network.
  The allowlist is `RECORDED_RUNS` in `run-viewer.tsx`.
- **Any other run key streams live** from that API and accepts interventions, created by an MCP
  client calling the tools on the self-hosted MCP server (see [`skill/README.md`](skill/README.md))
  — `start_run` returns a `watch_url` you can open immediately.

`frontend/.env.example` documents the variable; it deliberately ships **commented out**, because
there is no default host to point at any more.

**All shape differences between backend payloads and what the UI wants are absorbed in
`frontend/lib/donald/source.ts` (the adapter) and `frontend/lib/donald/reduce.ts` (the
reducer). If a payload does not match, fix the adapter — never reshape the UI, and
never ask the backend to reshape events.**

---


## The database — there is nothing to connect to

The MySQL that backed the old deployment lived in a microk8s cluster on a Linode box that is
dead, and the tunnel that replaced it is off. **There is no running database and no REST API.**
You cannot read live runs, and you do not need to: the five recordings in
`frontend/lib/donald/events.*.jsonl` are real captured event logs and go through the exact same
adapter and reducer as live data.

What still exists in the repo, for when someone self-hosts:

- `deploy/schema.sql` — the full schema. `agent_event` is the source of truth (append-only,
  per-run monotonic `sequence`); nodes and edges are materialised snapshots of it.
- `backend/donald/` — the Go REST API and MCP server, generated by nuzur from the
  `v2-run-graph-events` model. Every table is exposed as generated CRUD in kebab-case, plus
  the curated `/v1/runs` endpoints. The OpenAPI contract is served at `/v1/openapi.yaml` by a
  **running** instance.
- Credentials for the old box existed only in a root-only file on it. They are not recoverable
  and not needed.


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

`readme.md` is the up-to-date picture and this file is the operational contract. When they
disagree with anything else, they win, then the code.

Known stale, do not trust:

- **`HANDOFF.md` §1** — describes an outage of the old `todes.mx` deployment, two deployments
  ago. Its house rules and scope tables are still valid.
- **`INTEGRATION.md`** — backend asks that were fixed long ago.
- **`deploy/README.md` and the Helm charts** — they describe the Linode/microk8s topology.
  Still correct as a *recipe*; nothing is running.
- **Anything anywhere promising `api.usedonald.com` or `mcp.usedonald.com`.** Those hosts are
  gone. If you find such a reference, fix it rather than following it.
