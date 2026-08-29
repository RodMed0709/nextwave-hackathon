# Use case 06 — Wide parallel sweep across a portfolio

**run_key** `nauta-sweep-006` · ~5 min · ends `succeeded`
**Shows** — a wide fan-out (twelve concurrent lanes), a join across all of them, four
named agents working at once, and one exception surfacing out of a quiet crowd

## The story

The nightly sweep. Nauta watches **twelve containers** across four importers and asks one
question of each: is anything about to cost money? Eleven are fine. One is not.

This is the scenario that shows what the product actually is — not a single workflow, but
continuous supervision across a portfolio, with the exceptions rising to the top.

## Why it demos well

Every other scenario is a story about one shipment. This one puts twelve lanes on screen
moving at once, then collapses them into a single verdict. It is the best answer to *"what
does this look like at scale?"* and it exercises the DAG harder than anything else here.

## The plan

**Stage 1 — INGEST, one step**

| node_key | Label | Agent | ~sec |
|---|---|---|---|
| `ingest_portfolio` | Load the active container portfolio | Nina | 10 |

**Stage 2 — MONITOR, twelve steps in parallel**, all depending on `ingest_portfolio`:

| node_key | Container | Agent | ~sec |
|---|---|---|---|
| `check_mscu4471820` | MSCU-4471820 | Nina | 14 |
| `check_mscu4471835` | MSCU-4471835 | Nina | 11 |
| `check_tghu8890114` | TGHU-8890114 | Theo | 16 |
| `check_tghu8890230` | TGHU-8890230 | Theo | 9 |
| `check_cmau7712004` | CMAU-7712004 | Nina | 13 |
| `check_cmau7712119` | CMAU-7712119 | Theo | 18 |
| `check_oolu6650331` | OOLU-6650331 | Marcus | 12 |
| `check_oolu6650412` | OOLU-6650412 | Marcus | 15 |
| `check_hlxu4420087` | HLXU-4420087 | Lauren | 10 |
| `check_hlxu4420155` | HLXU-4420155 | Lauren | 17 |
| `check_segu9983001` | SEGU-9983001 | Vera | 13 |
| `check_segu9983144` | SEGU-9983144 | Vera | 11 |

**Stage 3 onward — the funnel**, joining all twelve:

| # | Stage | node_key | Label | Agent | ~sec | Depends on |
|---|---|---|---|---|---|---|
| 3 | DETECT | `detect_exceptions` | Collect exceptions | Theo | 18 | all twelve |
| 4 | EXPLAIN | `explain_exception` | Root cause the exception | Theo | 22 | 3 |
| 5 | IMPACT | `calculate_exposure` | Quantify exposure | Marcus | 20 | 4 |
| 6 | PLAN | `plan_response` | Rank responses | Marcus | 18 | 5 |
| 7 | DECIDE | `decide_response` | Decide within policy | Alec | 8 | 6 |
| 8 | ACT | `act_extend_free_time` | Buy free time | Nina | 16 | 7 |

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

**Start all twelve before completing any.** That is the whole visual. Stagger the
completions using the durations above — 9s finishes first, 18s last — so lanes retire
unevenly rather than snapping shut together.

Eleven report a variant of:
> "Inside free time, on schedule. No action."

One does not. `check_cmau7712119`:
> "**Vessel arrived 2 days early.** Free time started 2 days sooner than planned and the
> pickup is booked for after it expires."

Then the funnel:
- `detect_exceptions` → "1 exception in 12: CMAU-7712119 will enter detention 14-SEP."
- `explain_exception` → "Early berth at Manzanillo. Our pickup was scheduled off the original ETA and never rescheduled."
- `calculate_exposure` → "**USD 840** detention over 4 days at $210, rising if the pickup slips further."
- `plan_response` → "1) Move the pickup forward — $0. 2) Buy 3 free days — $450. 3) Absorb — $840."
- `decide_response` → "The truck slot on 12-SEP is gone; option 2 at $450 beats absorbing $840. Inside policy."
- `act_extend_free_time` → "3 additional free days purchased. Ref FT-88120. Detention avoided."

```
finish_run(status="succeeded",
  message="12 containers swept, 1 exception found and cleared. USD 840 exposure closed for USD 450.")
```

## What to look for on screen

- Twelve lanes live at once under six named agents
- Eleven quietly going green while one goes amber — the exception finds *you*
- Twelve edges converging on a single DETECT node
- A portfolio-level closing number

## Corner case in the same shape

Run it with **two** exceptions that interact — one container early, one late, competing for
the same truck slot. The PLAN step then has to rank across both, and DECIDE goes to a human
gate because resolving one worsens the other. That is the version to show a sceptical
operator.
