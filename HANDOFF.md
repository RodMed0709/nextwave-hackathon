# Donald — state of play

**Read this first.** It is written for whoever picks the work up next, human or agent, and it
replaces reconstructing the context from git history. Last updated 29-AUG-2026, late.

---

## 1. What changed

**Maykel is gone**, and he owned two things nobody else on the team owns:

- the nuzur project the backend is generated from (`v2-run-graph-events`, in the nuzur SaaS at
  app.nuzur.com — **not in this repository**);
- the deployment, including the database credentials, which live in a `prod.yaml` that was never
  committed. Only `deploy/prod.yaml.example` is here.

**As of writing, all three deployed services are down**: `api.`, `mcp.` and `donald.todes.mx`.
DNS still resolves to 45.33.12.143 and TCP/443 accepts connections, but the TLS handshake times
out — the host is alive and the ingress behind it is not. It may come back. Plan as if it will not.

### What this rules out

- No schema changes. Nobody here can publish a new nuzur version or regenerate.
- No database access, no data dump, no migration. There is no migration system anyway.
- No live agent runs while the MCP endpoint is down.

### What survives

- **This repository, mirrored to `github.com/RodMed0709/nextwave-hackathon`**, every branch.
- **The schema**, in `deploy/schema.sql` and `backend/donald/core/repository/sql/schema/create.sql`.
  Rebuilding the database is running that SQL. Note `deploy/scripts/03-deploy.sh:96` asserts
  exactly seven tables.
- **The deployment recipe**, in `deploy/`.
- **One complete recorded run**, `frontend/lib/donald/events.land-pickup.jsonl`.

---

## 2. The demo does not need any of that

This is the load-bearing fact. `frontend/components/donald/run-viewer.tsx` picks its source from
one environment variable:

```ts
return API_BASE_URL ? liveSource(API_BASE_URL, runKey) : recordedSource({ recording: runKey })
```

With `NEXT_PUBLIC_DONALD_API` unset, the whole product runs from a JSONL file through the **same
reducer, the same components and the same presentation layer** the live path uses. Only the
transport differs.

```bash
cd frontend && npx.cmd pnpm@10 install && npx.cmd pnpm@10 dev
# localhost:3000                 → the default recorded run
# localhost:3000/runs/land-pickup → the Berríos land pickup conflict
```

On Windows use `npx.cmd`, not `npx`: PowerShell blocks `npx.ps1`.

**Recorded mode is now the primary plan for the pitch, not the fallback.** A live run is a bonus
if the endpoint returns.

### If the API comes back, do this first

```bash
python scripts/export-runs.py
```

It pulls every run through the public read API and writes one replayable JSONL per run into
`backup/runs/`, plus an index. No credentials needed. Roughly thirty runs are in there, including
every Nauta scenario that has been enacted for real. **Run it the moment the endpoint answers**;
that data exists nowhere else.

---

## 3. Scope — what we are NOT doing

Time is short. These are decided, not open for reconsideration:

| Frozen | Where it lives | Why |
|---|---|---|
| **Robot motion** | `feat/donald-robot-motion` | Last thing to present, if at all. Do not spend time here. |
| **Node subtasks** | `feat/node-subtasks` | Complete and green, deliberately parked. See `docs/subtask-storage.md`. |
| Anything touching nuzur, the schema, or a migration | — | Impossible without the owner. |
| Backend changes generally | — | Nobody can deploy them. |

**The work that is left is content, and content only.** The frontend already renders more than the
scenarios tell it. That is the gap to close, and closing it needs no backend, no schema, and
carries no risk.

---

## 4. The three use cases we present

Not seven. Three, each earning its place by showing something the other two cannot.

| # | Case | The one thing it proves |
|---|---|---|
| **02** | Missing commercial invoice (`nauta_agent_blocked_on_data.md`) | A stuck run **looks** stuck. It goes amber, names exactly what it needs, and resumes on the same node. |
| **05** | Replan mid-flight (`nauta_agent_replan_midflight.md`) | **The graph rewires itself** because the agent learned something. A straight line becomes a diamond, with the cause quoted on screen. |
| **08** | Berríos land pickup (`nauta_agent_land_pickup_conflict.md`) | A different customer, country and failure, rendering with **zero new frontend code**, ending in a human gate with three priced options. |

Everything else — happy path, parallel sweep, failure, edge cases — stays in `nauta-dummy/` as
regression material and is not part of the pitch.

---

## 5. The work, in sections

Independent of each other. Two people or two agents can take different sections without collision.

### A · Narration — the highest-value work

The briefs say what steps an agent takes. They barely say what it **finds**. Compare:

```
today   identify_po → "Match to purchase order"
wanted  identify_po → "Searching the supplier portal…"
                    → "Found PO-44190 — 9 SKUs, FOB Ningbo"
```

This needs **no code**. `report_progress(message=…)` already exists, ships today, and renders in
`live-status` on the card. Rewrite the three briefs above so every step narrates what it looked
for and what came back, with real identifiers.

Owner: whoever writes best. Files: `nauta-dummy/*.md` only.

### B · The empty header field

`frontend/components/donald/run-viewer.tsx` renders **Client / Task / Nauta agent**, and every run
shows `CLIENT: Unavailable` because no scenario sends it. One field in `start_run`, and the header
stops looking broken. Cheap, visible, do it early.

### C · Recordings and video

Each case becomes a `.jsonl` and plays without a backend. `frontend/app/api/donald-recording/route.ts`
resolves a name through an allowlist — **add new recordings there, never join the query parameter
onto a path**. `frontend/lib/donald/events.recorded.jsonl` is read directly by
`frontend/tests/donald/reduce.test.ts`; leave it alone and add new files beside it.

Record with the Replay control in the header, which replays a run at the pace it happened.

### D · Cleanup, only if time allows

- `INTEGRATION.md` is stale on all three of its asks. `node_key` reaches the client, the plan
  travels inside `plan_declared`, and `intervention_requested` is emitted from `app/mcp/web_api.go`.
  Someone reading it today hunts for bugs that were fixed.
- The run list is full of internal engineering runs (`edge-anchor-1`, `task2_rereview_…`). With no
  `?run=`, the frontend falls back to *the newest run*, which was whatever an agent last executed.
  Recorded mode sidesteps this entirely.

---

## 6. Branches

Everything is mirrored to `github.com/RodMed0709/nextwave-hackathon`.

| Branch | What it is |
|---|---|
| `main` | Maykel's last state: drawer, zoom, replay, suggestions, `intervention_requested` |
| `use-case-03` | **Work here.** Mau's top controls merged onto main, plus recordings by name |
| `feat/ui-top-controls` | Mau's original commit, untouched |
| `feat/donald-ui-v2` | Holds `frontend/public/donald-pet/donald-default.webp`, Mau's robot. **Not in main** |
| `feat/node-subtasks` | Parked, complete, green |
| `feat/donald-robot-motion` | Frozen |
| `nauta-dummy`, `feat/pitch-ready-demo` | Historical |

### House rules

- Never commit straight to `main`. Branch, then let a human merge.
- `frontend/AGENTS.md` before touching Next.js; Next 16 docs are in `frontend/node_modules/next/dist/docs/`.
- Do not edit anything under `backend/donald/entity/`, `enums/`, `core/`, `rest/`, `config/` or
  `main.go` — 239 generated files listed in `.nuzur-codegen-manifest.json`. `app/` is the free zone.
- **There is no Go toolchain on this machine.** `go test ./...` cannot run. Say so rather than
  claiming a backend change is verified.
- Gates that do work: `npx.cmd tsc --noEmit`, `npx.cmd pnpm@10 test`, `npx.cmd pnpm@10 build`.
