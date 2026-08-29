# Use case 03 — Human gate: waiting on a decision

**run_key** `nauta-human-gate-003` · ~4 min · ends `succeeded`
**Shows** — stage 11 DECIDE as a real human gate, `block_action` with `user_decision`,
and the two-way loop: `check_instructions` → act → `resolve_instruction`

## The story

A vessel is delayed and a **stockout is genuinely on the table**. The agent has two
credible responses and they differ by **USD 8,400**. Nauta's policy says an agent may
decide alone up to $2,000. This one goes to a person.

This is the scenario where the graph stops being a progress bar and becomes a control.

## The plan

| # | Stage | node_key | Label | Agent | ~sec | Depends on |
|---|---|---|---|---|---|---|
| 1 | INGEST | `ingest_delay_notice` | Read carrier delay notice | Nina | 8 | — |
| 2 | IDENTIFY | `identify_affected_skus` | Identify affected SKUs | Marcus | 14 | 1 |
| 3 | MONITOR | `monitor_stock_cover` | Check days of cover | Marcus | 18 | 2 |
| 4 | PREDICT | `predict_stockout` | Forecast stockout date | Marcus | 30 | 3 |
| 5 | DETECT | `detect_stockout_risk` | Confirm the exception | Marcus | 12 | 4 |
| 6 | EXPLAIN | `explain_delay` | Root cause of the delay | Theo | 20 | 5 |
| 7 | IMPACT | `calculate_lost_sales` | Revenue at risk | Marcus | 26 | 5 |
| 8 | PLAN | `plan_options` | Generate and rank responses | Marcus | 28 | 6, 7 |
| 9 | DECIDE | `decide_expedite` | **Human gate** | Alec | — | 8 |
| 10 | ACT | `act_book_airfreight` | Book partial airfreight | Nina | 22 | 9 |
| 11 | ACT | `act_notify_planning` | Notify demand planning | Nina | 12 | 9 |

Steps 6 and 7 run in parallel and join at 8.

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

Work 1–8 normally. Give `predict_stockout` its full 30 seconds with progress lines — the
audience needs to believe the forecast was computed, not asserted.

- `monitor_stock_cover` → "SKU NB-990-GRY: 11 days of cover at current run rate."
- `predict_stockout` → "Stockout 22-SEP if we wait for the vessel. Confidence 0.79."
- `detect_stockout_risk` → "Confirmed: 6-day gap between stockout and revised arrival."
- `explain_delay` → "Typhoon Nanmadol closed Ningbo for 38 hours; the vessel lost its window."
- `calculate_lost_sales` → "Revenue at risk **USD 34,200** across 6 days at the current rate."
- `plan_options` → the two options below

### 9 · The gate

```
start_action(node_key="decide_expedite")
report_progress(node_key="decide_expedite",
  message="Two viable options; cost delta USD 8,400 exceeds the USD 2,000 autonomous limit")

block_action(node_key="decide_expedite", reason="user_decision",
  message="Airfreight 400 units to cover the gap (USD 8,400, arrives 18-SEP) or wait for the vessel and accept a 6-day stockout (USD 34,200 revenue at risk). Above my autonomous limit — need a call.")
```

State the options **and both numbers** in the message. A gate that says "need approval"
without the tradeoff is not a gate, it is an interruption.

### Wait for the human

Poll while you wait:
```
check_instructions(run_key="nauta-human-gate-003")
```
Call it every ~10 seconds, with `wait(10, "waiting for the operator")` between polls. It returns an empty list until someone acts. **Say nothing
between polls** — the node stays amber, the run stays blocked, and the demo audience is
looking at a system that is genuinely waiting for them.

In the demo, someone clicks steer in the UI with: *"Airfreight it, but only 400 units."*

### Act on it, then close the loop

```
resolve_instruction(id="<id from check_instructions>", outcome="applied",
  response="Booking 400 units airfreight, arrival 18-SEP. Remaining 1,100 units stay on the vessel.")

start_action(node_key="decide_expedite")
complete_action(node_key="decide_expedite", output_summary="Approved by operator: partial airfreight, 400 units")
```

`resolve_instruction` is not optional. Until it lands, the person who clicked the button
cannot tell whether you heard them — the UI can say *delivered* but not *honoured*.

### 10 & 11 · ACT, in parallel

- `act_book_airfreight` → "Booked CX-2044, 400 units, ETA MEX 18-SEP. Ref AWK-4471."
- `act_notify_planning` → "Demand planning notified: 400 units land 18-SEP, balance 24-SEP."

```
finish_run(status="succeeded",
  message="Partial airfreight approved and booked. Stockout avoided; USD 34,200 protected for USD 8,400.")
```

## Corner cases in the same shape

- **The human says stop instead of steer.** `check_instructions` returns a stop →
  `cancel_action` on `decide_expedite`, `skip_action` on both ACT steps, then
  `finish_run(status="cancelled")`.
- **Nobody answers.** Poll six times, then `finish_run(status="failed", message="No
  decision within the window; escalated by email.")` with the gate still blocked.
