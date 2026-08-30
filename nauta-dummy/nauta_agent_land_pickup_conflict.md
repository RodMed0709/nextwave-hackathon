# Use case 08 — Land pickup conflict, and the work inside a step

**run_key** `nauta-land-pickup-008` · ~4 min · ends `succeeded`
**Shows** — **subtasks inside a card**: a step that declares its own checklist on entry, one item
failing without failing the step, and a fourth item the agent did not plan appearing mid-step.
Also a human gate with three priced options, and a different customer in a different country.

## Why this one exists

Every other scenario in this folder proves the graph comes from the work. This one proves the same
thing **one level down**, inside a single card.

A step that runs for thirty seconds is one line of status text that keeps getting replaced. You can
see that it is working. You cannot see what it is working *on*, and when it stalls you cannot see
which part stalled. Subtasks are that missing layer — declared when the agent enters the step, not
at the top of the run, because the agent does not know a step's shape until it is inside it.

It is also a different world: **Berríos**, a distributor in San Juan, moving containers over land
in Puerto Rico. Different customer, different geography, different failure — and zero new frontend
code. That is the same argument the L'Oréal invoice makes, made again where the jury can check it.

## The story

The land carrier's API answers at 14:02 on a Tuesday: **no capacity** for container
**BERU-40022** in the Thursday 09:00 window. The next slot they can offer is two days later.

Two days would be nothing, except free time on this container expires **Wednesday 23:59**, and the
carrier's earliest slot is Thursday 09:00 — nine hours and one minute past the deadline. There is a
rebooking cutoff at **Wednesday 17:00**, and before that cutoff rebooking is free.

So there is a window, it is closing, and nobody at Berríos knows yet.

## The cast

| Agent | Role |
|---|---|
| Ari | Land operations |

One lane on purpose. This run is a single agent working a single container — the contrast with
`nauta_agent_parallel_sweep.md` is part of what makes both legible.

## The plan to declare

Twelve stages, declared in one `declare_actions` call before any work starts. Pass `agent_label`
on every step. Steps 5 and 6 run in parallel and join at 7 — use `depends_on: [...]` there, not
`after`.

| # | Stage | node_key | Label | ~sec | Depends on |
|---|---|---|---|---|---|
| 1 | INGEST | `ingest_capacity_response` | Read the carrier capacity response | 8 | — |
| 2 | IDENTIFY | `identify_operation` | Identify container and operation | 12 | 1 |
| 3 | EXTRACT | `extract_response_terms` | Extract reason code and cutoffs | 20 | 2 |
| 4 | RECONCILE | `reconcile_free_time` | Compare against free-time terms | 24 | 3 |
| 5 | MONITOR | `monitor_free_time_clock` | Track the free-time clock | 14 | 4 |
| 6 | PREDICT | `predict_overrun` | Forecast the overrun | 26 | 4 |
| 7 | DETECT | `detect_capacity_conflict` | Confirm the exception | 12 | 5, 6 |
| 8 | EXPLAIN | `explain_root_cause` | Root cause the conflict | 34 | 7 |
| 9 | IMPACT | `calculate_exposure` | Quantify the exposure | 20 | 8 |
| 10 | PLAN | `plan_responses` | Generate and rank responses | 24 | 9 |
| 11 | DECIDE | `decide_response` | **Human gate** | — | 10 |
| 12 | ACT | `act_book_alternate` | Book the alternate carrier | 22 | 11 |

## Subtasks — the point of this scenario

`start_action` and `report_progress` take an optional `subtasks` array:

```
start_action(node_key="explain_root_cause", subtasks=[
  {key: "capacity_log",    label: "Check the carrier's capacity log"},
  {key: "alternates",      label: "Check alternate carriers in the network"},
  {key: "lane_history",    label: "Check the last 90 days on this lane"}
])
```

Three rules, and they are the whole contract:

1. **Send the complete list every time.** It is a snapshot, never a delta. A duplicate or
   out-of-order call cannot corrupt anything, and a list that grows is just a longer snapshot.
2. **Declare them on entry, not at the top of the run.** The agent does not know a step's shape
   until it is inside it. Same reason the plan itself is a proposal.
3. **`status` is one of** `pending` · `running` · `done` · `skipped` · `failed`. Omitted means
   `pending`.

### Where the line sits

**Anything irreversible or costing money is a node, not a subtask.** A subtask has no
`cancel_action`, no decision panel, no intervention — there is no way to stop one. Hide *send the
email* inside a card and the operator lost the brake at the exact moment it mattered.

In this run the outbound email lives inside `act_book_alternate`, which is a node, and a human
approved it at step 11 before it could run. Its subtasks are the mechanics after that approval.
Had there been no gate, sending it would have needed its own node.

## Pacing

This server exposes a **`wait`** tool. The durations above are not decoration: spend them.

```
start_action(node_key="explain_root_cause", subtasks=[…])
wait(12, "reading the capacity log")
report_progress(node_key="explain_root_cause", message="Supplier fully booked Thursday",
  subtasks=[…])
```

A single `wait` is capped at **30s** — chain several with a `report_progress` between them so the
graph keeps moving. If `wait` is not in your tool list, pacing is off on the server: say so rather
than pretending.

**The duration is the intervention window.** A step that finishes instantly gives nobody time to
read its subtasks, which makes this entire scenario pointless.

## How to run it

### 1 · INGEST — `ingest_capacity_response`
> Land Carrier Network answered the pickup request for BERU-40022: **capacity negative** for the
> Thursday 09:00 window.

Attach the payload:
```
attach_artifact(name="Capacity response — BERU-40022", type="text",
  text="source: Land Carrier Network API\nreceived: 14:02:03\ncapacity: NEGATIVE\nreason_code: CAP-FULL\noffered_window: Thu 09:00\nrebooking_cutoff: Wed 17:00")
```

### 2 · IDENTIFY — `identify_operation`
> Container BERU-40022, PO-88213, Land Pickup Handoff run #4,812. Berríos, San Juan.

### 3 · EXTRACT — `extract_response_terms` · 4 subtasks
```
start_action(node_key="extract_response_terms", subtasks=[
  {key: "reason",  label: "Read the reason code"},
  {key: "window",  label: "Read the offered window"},
  {key: "cutoff",  label: "Find the rebooking cutoff"},
  {key: "fee",     label: "Check the reschedule fee"}
])
```
Walk them one at a time. Finish with:
> Reason **CAP-FULL**. Offered window Thu 09:00. Rebooking cutoff **Wed 17:00**, and rebooking
> before that cutoff costs **$0**.

That last item is the one that makes a cheap outcome possible later. Let it land as its own line.

### 4 · RECONCILE — `reconcile_free_time` · 3 subtasks
`pull_terms` → `compute_deadline` → `compare`.
> Free time expires **Wed 23:59**. The carrier's earliest slot is Thu 09:00 — **9h 01m past the
> deadline.** That is the mismatch.

### 5 & 6 · MONITOR and PREDICT — parallel
- `monitor_free_time_clock` → "1 day 9 hours left. Now the most urgent of 14 active operations."
- `predict_overrun` → "Unresolved by Wed 17:00 means clearing free time roughly 2 days late."

Give PREDICT its full 26 seconds with progress lines.

### 7 · DETECT — `detect_capacity_conflict`
> **Land pickup capacity conflict on BERU-40022.** This is outside the three documented
> automations — it needs reasoning, not a rule.

### 8 · EXPLAIN — `explain_root_cause` · the star of this scenario

Declare three subtasks on entry. Then, **while working the first one**, discover a fourth and send
a four-item snapshot:

```
# after the capacity log comes back
report_progress(node_key="explain_root_cause",
  message="Supplier fully booked Thursday — a local holiday cut the available slots",
  subtasks=[
    {key: "capacity_log", label: "Check the carrier's capacity log",        status: "done"},
    {key: "holiday",      label: "Confirm the San Juan holiday calendar",   status: "running"},
    {key: "alternates",   label: "Check alternate carriers in the network", status: "pending"},
    {key: "lane_history", label: "Check the last 90 days on this lane",     status: "pending"}
  ])
```

The fourth item was not in the plan thirty seconds ago. It exists because the agent learned
something — and the card grows to say so, without a new event type and without asking anyone.

Finish the rest:
- `alternates` → "Two alternates checked. **One confirms Wednesday morning.**"
- `lane_history` → "First occurrence in 90 days on this lane. Not a pattern."

> Root cause: a local holiday cut Thursday's slots at the trucking supplier. One alternate carrier
> has Wednesday morning availability.

### 9 · IMPACT — `calculate_exposure`
> Exposure **$276–414** if this clears two days late, against a North American average of
> $138–150 per day. **$0** rebooking fee if it is resolved before Wed 17:00.

### 10 · PLAN — `plan_responses` · 3 subtasks, one per option priced
> 1. **Book the alternate carrier, Wednesday AM — $0.** Recommended.
> 2. Request a 48h port extension — $90 admin fee, not guaranteed.
> 3. Accept the miss and notify finance — $276–414.

### 11 · DECIDE — the human gate
```
block_action(node_key="decide_response", reason="user_decision",
  message="Alternate carrier Wednesday AM at $0, a 48h port extension at $90 that may be refused, or accept a $276-414 miss. Outside my auto-approval threshold - need a call.")
```
Poll with `check_instructions` every ~10s and `wait(10, "waiting for the operator")` between polls.
Say nothing between polls — the node stays amber and the run stays visibly blocked.

In the demo, someone picks the alternate carrier. Then `resolve_instruction` — not optional. Until
it lands, the person who clicked cannot tell whether you heard them.

### 12 · ACT — `act_book_alternate` · 3 subtasks
`draft_request` → `send_request` → `record_confirmation`.

Attach the outbound message:
```
attach_artifact(name="Pickup request — BERU-40022", type="text",
  text="TO: dispatch@altcarrier.pr\nFROM: ops-automation@berrios-nauta.pr\nSUBJECT: Pickup request - BERU-40022, Wed AM window\n\nRequesting pickup for container BERU-40022 (PO-88213), Wednesday AM window. Original carrier at capacity for Thursday. Please confirm earliest available slot.")
```

> Confirmation **#ALT-9931**. Pickup set for Wed 08:00 — clears free time with about 12 hours to
> spare.

```
finish_run(status="succeeded",
  message="BERU-40022 rebooked with an alternate carrier for Wed 08:00. Clears free time with 12h to spare. $276-414 exposure avoided at no rebooking cost.")
```

## What to look for on screen

- A card with a checklist under its status line, items settling one at a time
- **A fourth item appearing in EXPLAIN that was not there when the step began** — the plan changing
  inside a card, which is the run-level replan at a fraction of the cost
- One subtask marked failed while its step keeps going, because a source coming back empty is a
  finding, not a failure
- The decision panel opening on the node with three options that each carry a real number
- A closing figure a distributor in San Juan would recognise as money

## Corner cases in the same shape

- **The operator picks the port extension.** Partial approval: 24h granted, new deadline Thu 23:59,
  $90 admin fee incurred, exposure still avoided as long as Thursday holds.
- **The operator accepts the miss.** `act_book_alternate` is skipped with a stated reason and
  finance is notified instead. Not a savings outcome — but a fully explained charge rather than an
  unexplained line on next month's invoice. Worth showing once: not every run ends in a win, and
  the ones that do not are exactly where a supervision surface earns its keep.
- **Nobody answers before Wed 17:00.** The free rebooking window closes while the gate is still
  open. `finish_run(status="failed")` with the cost of the silence named in the message.
