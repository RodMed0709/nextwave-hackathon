# Use case 05 — The plan changes under you

**run_key** `nauta-replan-005` · ~5 min · ends `succeeded`
**Shows** — a declared plan being revised mid-run with a stated cause: work added,
planned work skipped, dependencies rewired, `graph_revision` climbing

## The story

The agent starts a routine arrival check. Four steps in, the bill of lading reveals an
**unplanned transshipment at Busan** that was not in the booking. That single fact
invalidates half the plan: the original BL no longer describes the actual carriage, the
ETA is wrong, and a new leg needs its own documents.

Nothing failed. The agent **learned something** — and the graph has to change to stay true.

## Why this is the scenario to demo

A plan that never changes is a plan that was never real. If the graph only ever fills in
the shape it started with, the audience is watching a progress bar, and the whole
event-sourced design underneath is wasted.

Say the cause out loud on screen. Without it a replan reads as *the agent got it wrong*;
with it, it reads as *the agent found something*.

> ❌ "the plan changed"
> ✅ "Unplanned transshipment at Busan invalidates the original BL — BL MSCUXM2213"

## The plan as first declared (revision 1)

| # | Stage | node_key | Label | Agent | ~sec | Depends on |
|---|---|---|---|---|---|---|
| 1 | INGEST | `ingest_arrival_notice` | Read arrival notice | Nina | 8 | — |
| 2 | IDENTIFY | `identify_booking` | Match to booking | Nina | 12 | 1 |
| 3 | EXTRACT | `extract_bl` | Extract bill of lading | Theo | 22 | 2 |
| 4 | RECONCILE | `reconcile_routing` | Compare against booking | Theo | 26 | 3 |
| 5 | MONITOR | `monitor_eta` | Track ETA | Nina | 14 | 4 |
| 6 | ACT | `act_confirm_arrival` | Confirm arrival to the customer | Nina | 12 | 5 |

Six steps, a straight line. Declare it and start working.

## The turn

Run 1–3 normally. On step 4:

```
start_action(node_key="reconcile_routing")
report_progress(node_key="reconcile_routing", message="comparing BL routing against booking BKG-99210")
complete_action(node_key="reconcile_routing",
  output_summary="MISMATCH: BL shows transshipment at Busan onto MSC IRINA. The booking was direct Shanghai–Manzanillo.")
```

Now revise the plan **before doing anything else**. The graph is wrong the moment you know
it is wrong.

### Drop what no longer applies

```
skip_action(node_key="monitor_eta",
  reason="The booking ETA describes a direct sailing that is not what happened. Superseded by the two-leg ETA below.")
```

### Add what the discovery requires

```
add_action(node_key="extract_second_leg_bl", name="Extract second-leg BL",
  action_type="tool_call", agent_label="Theo", after="reconcile_routing")

add_action(node_key="verify_transshipment", name="Verify transshipment at Busan",
  action_type="tool_call", agent_label="Theo", after="reconcile_routing")

add_action(node_key="recompute_eta", name="Recompute two-leg ETA",
  action_type="reasoning", agent_label="Nina", after="extract_second_leg_bl")

add_action(node_key="assess_customs_impact", name="Assess customs impact of transshipment",
  action_type="reasoning", agent_label="Alec", after="verify_transshipment")
```

### Rewire the joins

```
add_dependency(from="verify_transshipment", to="recompute_eta")
add_dependency(from="recompute_eta", to="act_confirm_arrival")
add_dependency(from="assess_customs_impact", to="act_confirm_arrival")
```

`act_confirm_arrival` now waits on **two** predecessors instead of one. That re-layout —
a line becoming a diamond — is the visual moment of this demo.

### Then work the new plan

- `extract_second_leg_bl` (24s) → "Second BL MSCUBS4419: Busan → Manzanillo on MSC IRINA."
- `verify_transshipment` (18s) → "Confirmed at Busan 29-AUG. Transshipment is permitted under the service contract."
- `recompute_eta` (20s) → "Revised ETA **12-SEP**, five days later than the booking."
- `assess_customs_impact` (22s) → "No classification change. Origin unaffected: the goods did not enter Korean commerce."
- `act_confirm_arrival` (14s) → "Customer notified: ETA 12-SEP via Busan, both BLs attached."

```
finish_run(status="succeeded",
  message="Arrival confirmed on a revised two-leg routing. Plan revised once mid-run after the transshipment was discovered.")
```

## What to look for on screen

- A straight six-step line, then a visible re-layout into a branch and a join
- One node going grey (skipped) with a stated reason, not silently vanishing
- `graph_revision` incrementing on every structural change while the status ticks do not
  touch it — that distinction is what lets the UI tell *re-layout* from *repaint*
- The replan cause quoted on screen, tied to evidence (BL MSCUXM2213)

**Schema reminder.** Pass `agent_label` on every declared step so the UI can lane it, and
use `depends_on: [...]` (not `after`) wherever a step waits on more than one predecessor.
See `nauta_agent_happy_path.md` for a full worked `declare_actions` call.

## Pacing — how to actually take the time

This server exposes a **`wait`** tool (demo pacing is on). Durations in this brief are not
decoration: use `wait` to spend them.

```
start_action(node_key="predict_arrival")
wait(10, "modelling berth window")
report_progress(node_key="predict_arrival", message="berth window 07-SEP 12:00-18:00", percent=40)
wait(10, "scoring gate-out")
report_progress(node_key="predict_arrival", message="scoring gate-out probability", percent=75)
wait(8, "finalising")
complete_action(node_key="predict_arrival", output_summary="Berthing 07-SEP 14:00, gate-out 09-SEP. Confidence 0.82.")
```

A single `wait` is capped at **30s** — for longer, chain several with a `report_progress`
between them so the graph keeps moving instead of going silent.

**Without this the demo does not work.** An LLM has no clock and will fire every tool call
in seconds; the run finishes before anyone can read it, and stop and steer have nothing to
act on. If `wait` is missing from your tool list, pacing is disabled on the server — say so
rather than pretending, and see the deploy README for how to switch it on.
