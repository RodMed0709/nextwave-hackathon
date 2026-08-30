# Use case 02 — Waiting for a missing document

**run_key** `nauta-blocked-data-<unique-suffix>` · ~3 min · ends `succeeded` after a block clears
**Shows** — `block_action` with `missing_data`, the run going amber, then resuming

**Fresh-run rule.** Generate a new suffix for every demo and verify the graph is empty before
declaring the plan. Never reuse or resume a previous run for this scenario.

## The story

A supplier ships early and the container is already on the water, but the **commercial
invoice never arrived**. Without it Donald cannot verify the shipment value, calculate
duties, or submit the customs entry. The agent gets four steps in and stops — correctly.

This scenario shows Donald pausing visibly and safely when required information is missing.
Before `block_action` existed, an agent in this position had two bad options: keep posting
progress and pretend to be busy, or fail the step and overstate the problem. A run that is
waiting must clearly say what it needs, why work stopped, and how to continue.

## The plan

| # | Stage | node_key | Label | Agent | ~sec | Depends on |
|---|---|---|---|---|---|---|
| 1 | INGEST | `ingest_asn` | Read shipment notice | Nina | 8 | — |
| 2 | IDENTIFY | `identify_po` | Find purchase order | Nina | 12 | 1 |
| 3 | EXTRACT | `extract_packing_list` | Read packing list | Theo | 20 | 2 |
| 4 | EXTRACT | `extract_commercial_invoice` | Find commercial invoice | Theo | 25 | 2 |
| 5 | RECONCILE | `reconcile_customs_value` | Verify shipment value | Theo | 22 | 3, 4 |
| 6 | DETECT | `detect_classification_gap` | Check product codes | Alec | 18 | 5 |
| 7 | IMPACT | `calculate_duty` | Calculate duties and fees | Marcus | 20 | 6 |
| 8 | ACT | `act_file_entry` | Submit customs entry | Alec | 24 | 7 |

**Schema reminder.** Pass `agent_label` on every declared step so the UI can lane it, and
use `depends_on: [...]` (not `after`) wherever a step waits on more than one predecessor.
See `nauta_agent_happy_path.md` for a full worked `declare_actions` call.

## Pacing — how to actually take the time

This server exposes a **`wait`** tool (demo pacing is on). Durations in this brief are not
decoration: use `wait` to spend them.

```
start_action(node_key="extract_packing_list")
wait(7, "reading the packing list")
report_progress(node_key="extract_packing_list", message="Reading the packing list for purchase order PO-44190.", percent=35)
wait(7, "checking quantities")
report_progress(node_key="extract_packing_list", message="Checking product quantities and package counts.", percent=75)
wait(5, "finishing the packing-list check")
complete_action(node_key="extract_packing_list", output_summary="Packing list verified: 9 products across 118 packages.")
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
  message="Looking for the commercial invoice for purchase order PO-44190 in the supplier portal and shared mailbox.")

block_action(node_key="extract_commercial_invoice",
  reason="missing_data",
  message="Commercial invoice missing for purchase order PO-44190. Donald needs it to verify the shipment value and calculate duties. Add the invoice to continue; nothing has been submitted.")
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
report_progress(node_key="extract_commercial_invoice", message="Invoice 88907 received from the supplier.")
start_action(node_key="extract_commercial_invoice")
complete_action(node_key="extract_commercial_invoice",
  output_summary="Invoice 88907 verified: shipment value USD 96,400 across 9 products.")
```

`start_action` on a blocked step is how you resume. Same node_key — do not invent a new
one. (This path is also the regression test for the retry fix: a second `start_action` on
the same node used to be silently swallowed.)

### 5–8 · Carry on

- `reconcile_customs_value` → "Shipment value USD 96,400 matches purchase order PO-44190."
- `detect_classification_gap` → "Product codes verified. All 9 products are ready for filing."
- `calculate_duty` → "Duties USD 15,424. Processing fee USD 341."
- `act_file_entry` → "Customs entry 315-9982177-4 submitted. Release expected within 24 hours."

```
finish_run(status="succeeded", message="Customs entry submitted. Donald paused safely for 42 seconds, resumed from the same step, and completed the filing without guessing any values.")
```

Naming the blocked duration in the closing message is a nice touch — it is the number an
operations manager actually wants.

## Corner case in the same shape

Run it again and **never** unblock. Let `finish_run(status="failed", message="No commercial
invoice after 3 business days. Escalated to the supplier manager; nothing was submitted.")`
close it out with the step still blocked. Worth showing once: it proves a stuck run does not
sit open forever.
