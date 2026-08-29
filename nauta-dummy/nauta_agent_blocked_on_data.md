# Use case 02 — Blocked on missing data

**run_key** `nauta-blocked-data-002` · ~3 min · ends `succeeded` after a block clears
**Shows** — `block_action` with `missing_data`, the run going amber, then resuming

## The story

A supplier ships early and the container is already on the water, but the **commercial
invoice never arrived**. Without it customs value cannot be established, so classification
and duty cannot be computed. The agent gets four steps in and stops — correctly.

This is the scenario that proves a stuck run *looks* stuck. Before `block_action` existed
an agent in this position had two bad options: keep posting progress and lie about being
busy, or fail the step and overstate the problem. A run that is waiting must be visibly
waiting, or nobody comes to unblock it.

## The plan

| # | Stage | node_key | Label | Agent | ~sec | Depends on |
|---|---|---|---|---|---|---|
| 1 | INGEST | `ingest_asn` | Read advance shipping notice | Nina | 8 | — |
| 2 | IDENTIFY | `identify_po` | Match to purchase order | Nina | 12 | 1 |
| 3 | EXTRACT | `extract_packing_list` | Extract packing list | Theo | 20 | 2 |
| 4 | EXTRACT | `extract_commercial_invoice` | Extract commercial invoice | Theo | 25 | 2 |
| 5 | RECONCILE | `reconcile_customs_value` | Establish customs value | Theo | 22 | 3, 4 |
| 6 | DETECT | `detect_classification_gap` | Check HS classification | Alec | 18 | 5 |
| 7 | IMPACT | `calculate_duty` | Compute duty and fees | Marcus | 20 | 6 |
| 8 | ACT | `act_file_entry` | File customs entry | Alec | 24 | 7 |

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

## How to run it

Steps 1–3 run normally. Then:

### 4 · The block
`start_action` on `extract_commercial_invoice`, post one progress line, then:

```
report_progress(node_key="extract_commercial_invoice",
  message="searching supplier portal and mailbox for CI against PO-44190")

block_action(node_key="extract_commercial_invoice",
  reason="missing_data",
  message="No commercial invoice for PO-44190. Supplier portal has the packing list and the BL but no CI. Customs value cannot be established without it.")
```

Blocking the step also marks the **whole run** blocked — that is what puts it at the top
of an operator's list. Say so on screen.

### Sit in the block

**Spend 30–45 seconds here** — `wait(30, "blocked on the commercial invoice")` then
`wait(12, "still blocked")`. Do not rush past it. This is the shot: a graph frozen on one
amber node with a sentence explaining exactly what it needs. Post nothing during the wait —
silence is the point.

### The unblock

Then simulate the invoice arriving:

```
report_progress(node_key="extract_commercial_invoice", message="CI-88907 received from supplier")
start_action(node_key="extract_commercial_invoice")
complete_action(node_key="extract_commercial_invoice",
  output_summary="Invoice CI-88907 — USD 96,400, Incoterm FOB Ningbo, 9 SKUs")
```

`start_action` on a blocked step is how you resume. Same node_key — do not invent a new
one. (This path is also the regression test for the retry fix: a second `start_action` on
the same node used to be silently swallowed.)

### 5–8 · Carry on

- `reconcile_customs_value` → "Customs value USD 96,400 agrees with the PO."
- `detect_classification_gap` → "Two SKUs classified 6403.99 need review; the rest are clean."
- `calculate_duty` → "Duty USD 15,424 at 16%. MPF USD 341."
- `act_file_entry` → "Entry 315-9982177-4 filed. Release expected within 24h."

```
finish_run(status="succeeded", message="Entry filed. Blocked 41s waiting on the commercial invoice.")
```

Naming the blocked duration in the closing message is a nice touch — it is the number an
operations manager actually wants.

## Corner case in the same shape

Run it again and **never** unblock. Let `finish_run(status="failed", message="No commercial
invoice after 3 business days; escalated to the supplier manager.")` close it out with the
step still blocked. Worth showing once: it proves a stuck run does not sit open forever.
