# Engineering decisions

The calls we made, the alternatives we rejected, and why. Each one is traceable to code or a
document in this repository.

---

## 1. An append-only event log is the source of truth

**Decision:** `agent_event` is append-only, with a per-run monotonic `sequence` and a unique
`idempotency_key`. The graph a person watches is reconstructed by replaying events through one
reducer — never mutated in place.
**Alternative rejected:** mutable node/edge tables as the primary state, updated on every report.
**Why:** supervision is an audit problem. A log answers "what did the agent do, in what order,
and why" by construction; mutable state answers only "where is it now". Replay also gives
recovery for free — a client that missed deltas fetches "events after N", the same path it uses
on first load.

## 2. Snapshots (`agent_node` / `agent_edge`) exist alongside the log

**Decision:** keep materialised `agent_node` and `agent_edge` rows in addition to the event log.
**Alternative rejected:** replay-only — every reader reconstructs the run from event row zero.
**Why:** a browser opening mid-run should not replay a whole log before drawing a pixel. The
snapshot lets a client start from current state plus `last_sequence` and then follow deltas.
Because the snapshot is derived, it can be rebuilt from the log at any time — it is a cache with
a name, not a second source of truth.

## 3. Fan-out by tailing the database, not channels or a message bus

**Decision:** the API's `Broadcaster` (`backend/donald/app/mcp/bus.go`) polls the event table per
watched run every 400ms and pushes deltas to SSE subscribers.
**Alternative rejected:** in-process Go channels, or a Redis/pub-sub broker between writers and
readers.
**Why:** the MCP server and the API run as separate processes (`DONALD_ROLE=mcp` / `api`), so a
Go channel can never cross that boundary — the database already does, and it keeps every API
replica independent. At tens of runs a day, one indexed query per 400ms costs nothing, needs no
broker, and exercises the same "fetch events after N" path clients use to recover — so the
recovery path is tested continuously, not only in failure.

## 4. Five verbs over open MCP, not a proprietary SDK

**Decision:** the whole agent-facing contract is five verbs — DECLARE, ADVANCE, REPLAN, ASK,
FINISH — exposed as tools on a standard streamable-HTTP MCP server.
**Alternative rejected:** a per-provider SDK or agent-framework integration.
**Why:** any MCP client becomes supervisable by reading a skill file; we change nothing about the
provider's stages, logic or actions. An operator with three agent vendors does not want three
windows — and a vendor's own tracing UI only reaches the engineer who wrote the agent, not the
person who pays for its consequences.

## 5. Interventions are advisory, and the interface says so

**Decision:** stop and steer are written as intervention events; the agent picks them up on its
next `check_instructions` and honours them by changing its plan.
**Alternative rejected:** a "kill switch" UI implying Donald can halt a third-party agent.
**Why:** these agents run on infrastructure that is not ours — a hard stop we cannot enforce
would be theatre. Writing the brake as an event makes it auditable like everything else, and the
guaranteed behaviour is the honest one: when the agent lacks data it goes amber, says what is
missing, and resumes the same node instead of guessing.

## 6. Recorded and live runs behind one source selection

**Decision:** `run-viewer.tsx` keeps a three-key `RECORDED_RUNS` set; those run keys replay from
bundled recordings, and every other key streams from the real API and accepts interventions. Both
sources feed the same reducer, components and presentation layer.
**Alternative rejected:** a separate demo build, or a stage pitch that depends on the venue's
network and a healthy backend.
**Why:** the pitch must survive a dead Wi-Fi router — and the original deployment dying mid-week
proved the point. Because only the transport differs, showing a recording demonstrates the exact
product code, and a judge can still ask for a live run on the spot.

## 7. Duration is the intervention window

**Decision:** steps declare `estimated_seconds`, and demo pacing (`DONALD_DEMO_PACING`, a `wait`
tool) keeps runs unfolding at a readable speed.
**Alternative rejected:** letting every step complete instantly and animating the difference.
**Why:** you can only stop something that is still happening — a graph of instant steps has a
decorative stop button. The timing belongs to the task: progress appears when work takes time,
amber appears when data is missing, and the operator's brake has a window in which it means
something. Pacing is flagged as pre-production and switches off with one env var.

## 8. Subtasks travel in the event payload, not a new table

**Decision:** the subtask checklist rides as a snapshot inside `agent_event.payload` on every
`start_action` / `report_progress`, lifted into a typed field on read
(`docs/subtask-storage.md`).
**Alternative rejected:** a first-class `agent_subtask` entity in the nuzur model.
**Why:** the entity route requires changing the model in the nuzur SaaS, publishing a new
version, regenerating ~239 files and applying DDL by hand — with no migration system. The payload
route touched four hand-written files, zero generated ones, and no schema. The wire contract is
identical either way, so migrating later changes only storage: the agent and the frontend do not
change a line.

## 9. A regenerable backend made the redeploy survivable

**Decision:** the backend is generated by nuzur from a versioned model (`v2-run-graph-events`),
and `deploy/` holds the full recipe — schema SQL, Helm charts, scripts — as code.
**Alternative rejected:** a hand-written backend and a hand-configured, one-of-a-kind server.
**Why:** when the original deployment died with its owner's credentials (`HANDOFF.md`), nothing
recoverable was lost: the generated code, schema and deploy recipe were all in the repository.
The team stood the same version up on its own infrastructure (`usedonald.com`) in hours. The
system's ability to be rebuilt from what is checked in was tested for real, not claimed.

## 10. A written anti-scope, enforced

**Decision:** `PROBLEM.md` fixes what Donald is **not**: not Nauta's pipeline, not a configurable
dashboard, no multi-user or auth, no route/cost optimisation, not a Q&A chatbot, and nothing
persisted that the demo does not show.
**Alternative rejected:** letting the demo accrete features — filters, saved views, logins —
under hackathon pressure.
**Why:** the thesis is a supervision surface, and every excluded feature is a way to dilute it.
"If the person only asks and receives text, we have failed our own thesis" is a scope test the
team could apply in seconds, and it kept nine entities and five verbs from becoming forty.
