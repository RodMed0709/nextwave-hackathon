# Where subtasks are stored, and the option we did not take

Written on `feat/node-subtasks`, 29-AUG-2026, so nobody has to rediscover any of it.

Subtasks are the checklist a step declares when it starts: `{key, label, status}`, the whole
ordered list sent as a snapshot on every `start_action` and `report_progress`. The agent writes
them; nothing is inferred from text.

There were two ways to store them. We shipped the first. This is what the second costs, and what
it would buy, if there is ever room to pick it up.

---

## What we shipped — inside `agent_event.payload`

The snapshot is serialised into the event's `detail` field, which lands in the `payload JSON`
column that `agent_event` has had since `c14f018`, the first generation from the v2 model. Every
event in the system already uses that column: the message, the progress percent, the whole
declared plan inside `plan_declared`, and `manual_minutes`.

```
agent → start_action(subtasks=[…])
      → app/mcp/nodes.go serialises into payload.detail
      → INSERT into agent_event, payload JSON column
      → events_query.go lifts `subtasks` into a typed field
      → SSE → reducer → RunNode.subtasks → the card
```

**Cost:** four files, all under `backend/donald/app/mcp/`, which is the hand-written zone —
zero of the 239 files in `.nuzur-codegen-manifest.json`, no schema change, no migration, no
regeneration. An agent that sends no subtasks produces byte-identical events.

**This was not a shortcut around the architecture.** It is the same channel the backend owner
chose twice in the same week, and the reason is in his own comment at `app/mcp/nodes.go`, shipping
`manual_minutes`:

> *no hay columna y añadirla significa un cambio de esquema en nuzur*

---

## What it does not give us

Two real gaps, both consequences of the same thing — there is no subtask row, only an event.

**`get_graph` does not return them.** That tool reads `agent_node`, and `GraphAction` is
`node_key / name / status`. An agent recovering from context loss gets its nodes back but not its
checklist, and will most likely reinvent the keys. The snapshot contract means this corrupts
nothing — a fresh list simply overwrites — but the labels can change mid-step, which is exactly
the failure `nauta_agent_edge_cases.md` case C exists to catch.

**No SQL.** There is no `WHERE subtask.status = 'failed'`. Answering "which steps are stuck, and
on what" means parsing JSON in the query.

The browser is fine either way: it replays from `after=0` and rebuilds the list from the event
rows, so nothing is lost across a reload or a restart.

---

## The option we did not take — model it in nuzur

If subtasks should be first-class, this is the work. It is listed in order because step 1 gates
everything after it.

| # | Step | Where |
|---|---|---|
| 1 | Add an `agent_subtask` entity: `node_uuid` FK, `subtask_key`, `label`, `status`, `position` | **nuzur SaaS — not in this repo** |
| 2 | Publish a new project version, e.g. `v3-subtasks` | nuzur SaaS |
| 3 | Regenerate — ~32 new files, 239 in the manifest rewritten | `go-code-gen` |
| 4 | Take the DDL diff | `nuzur-cli deploy --plan --json` |
| 5 | Update `deploy/schema.sql` by hand — it already diverges from the generated copy | repo |
| 6 | Raise the table count assert | `deploy/scripts/03-deploy.sh:96` — it asserts exactly 7 |
| 7 | Apply the DDL to the live database by hand | **there is no migration system**: `find -iname "*migrat*"` returns nothing, and `create.sql` is all `CREATE TABLE IF NOT EXISTS`, so a new column on an existing database does not apply itself |

**Step 1 is the blocker for anyone but the backend owner.** The model lives in the nuzur SaaS
(`v2-run-graph-events`, `5cb1a21a-264d-4108-8170-4bf8b1109058`, see `deploy/README.md`), not in
this repository. Nothing in this repo can change it.

---

## Migrating later is cheap, which is why the order was this way

The wire contract is identical in both designs — the same `{key, label, status}` array on the same
two tools. So if the entity is ever modelled:

**Unchanged:** `StartActionParams` / `ReportProgressParams`, every validation (cap of 50, 120-char
labels, trimming, duplicate keys, the status enum), `skill/donald-flow/SKILL.md`, all of
`frontend/`, `nauta-dummy/nauta_agent_land_pickup_conflict.md`, and the tests.

**Changed:** roughly 60 of the 219 backend lines — `detailWithSubtasks` writes rows instead of
JSON, `liftDetail` reads them from the join instead of the blob, and `GraphAction` grows a
`Subtasks` field, which is what closes the `get_graph` gap.

The agent does not change a line. The frontend does not change a line. Only the storage does.

---

## Also worth carrying forward

- **`INTEGRATION.md` is stale on all three of its asks.** `node_key` reaches the client, the plan
  travels inside `plan_declared` rather than per-node `node_added` events, and
  `intervention_requested` is emitted from `app/mcp/web_api.go:228`. Someone reading it today goes
  hunting for bugs that were fixed.
- **`go test ./...` has never run against this branch.** There is no Go toolchain on the machine it
  was written on. One compile error did get through the merge — a duplicate `detail` field on
  `transitionSpec` — and it was caught by reading, not by a compiler. Assume there may be another
  until a real build says otherwise.
- **A run that never calls `finish_run` sits `in_progress` forever**, heartbeat frozen,
  indistinguishable from an agent still working. Nothing marks it stale. That is
  `nauta_agent_edge_cases.md` case F, and it is still open.
