# Use case 04 — Failure at the last step

**run_key** `nauta-failure-004` · ~3 min · ends `failed`
**Shows** — `fail_action` with a real reason, a retry that also fails, honest
`skip_action` on unreachable work, and a run that closes rather than hanging

## The story

Everything works. The agent ingests a demurrage dispute, gathers the evidence, builds a
solid case worth **USD 6,300** — and then the carrier's dispute portal rejects the
submission because the credentials were rotated overnight.

The interesting part is the last 40 seconds. A demo where nothing breaks proves nothing
about a monitoring product: what the audience needs to see is that **a failure is legible**
— which step, why, what was salvaged, and what a human has to do now.

## The plan

| # | Stage | node_key | Label | Agent | ~sec | Depends on |
|---|---|---|---|---|---|---|
| 1 | INGEST | `ingest_demurrage_invoice` | Read demurrage invoice | Nina | 8 | — |
| 2 | IDENTIFY | `identify_container` | Identify container and dates | Nina | 12 | 1 |
| 3 | EXTRACT | `extract_gate_records` | Extract terminal gate records | Theo | 24 | 2 |
| 4 | EXTRACT | `extract_free_time_terms` | Extract free-time terms | Alec | 20 | 2 |
| 5 | RECONCILE | `reconcile_timeline` | Rebuild the container timeline | Theo | 28 | 3, 4 |
| 6 | DETECT | `detect_overcharge` | Test the charge against terms | Alec | 16 | 5 |
| 7 | EXPLAIN | `explain_dispute_basis` | Assemble the evidence | Alec | 22 | 6 |
| 8 | IMPACT | `calculate_recovery` | Quantify the claim | Marcus | 14 | 7 |
| 9 | PLAN | `plan_dispute` | Draft the dispute | Alec | 20 | 8 |
| 10 | DECIDE | `decide_file` | Decide to file | Alec | 8 | 9 |
| 11 | ACT | `act_submit_dispute` | Submit to carrier portal | Nina | 18 | 10 |
| 12 | ACT | `act_log_claim` | Log the claim in the ERP | Nina | 12 | 11 |

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

Steps 1–10 all succeed, and they should feel confident — the failure lands harder if the
work before it was good.

- `extract_gate_records` → "Gate-in 02-SEP 09:14, gate-out 11-SEP 16:40. Terminal API."
- `extract_free_time_terms` → "Contract MX-2026-118: 7 free days from discharge."
- `reconcile_timeline` → "Discharge 02-SEP. Free time expires 09-SEP. Two chargeable days."
- `detect_overcharge` → "**Carrier billed 5 days, not 2.** Three days billed inside free time."
- `explain_dispute_basis` → "Terminal gate log contradicts the carrier's discharge date by 3 days."
- `calculate_recovery` → "Recoverable **USD 6,300** of the USD 10,500 invoiced."
- `plan_dispute` → "Dispute drafted with gate log, contract clause 7.2 and the invoice."
- `decide_file` → "Inside policy: documentary dispute, no commercial concession. Filing."

### 11 · The failure

```
start_action(node_key="act_submit_dispute", input_summary="Dispute DSP-4471 to MSC portal")
report_progress(node_key="act_submit_dispute", message="authenticating to MSC eBusiness portal")

fail_action(node_key="act_submit_dispute",
  error="MSC portal rejected authentication: HTTP 401, 'credentials expired'. The service account password was rotated on 28-AUG and the stored secret was not updated. Dispute DSP-4471 is drafted and complete but unsubmitted.")
```

**The error text is the whole point of this scenario.** Compare:

> ❌ `error="submission failed"`
> ✅ `error="MSC portal rejected authentication: HTTP 401 … the service account password was rotated on 28-AUG … dispute is drafted and complete but unsubmitted"`

The second tells an operator which system, which cause, and what survived. The first tells
them to go and read logs. `fail_action` requires a reason for exactly this reason.

### The retry — which also fails

Try once. Agents should, and a visible retry makes the failure credible rather than lazy.

```
start_action(node_key="act_submit_dispute")
report_progress(node_key="act_submit_dispute", message="retrying with cached session token")
fail_action(node_key="act_submit_dispute",
  error="Retry failed identically: HTTP 401. The cached token was issued under the same rotated credential. This needs a human to update the stored secret.")
```

Both attempts appear on the graph. (This is also the live proof of the retry fix — the
second `start_action` on an already-failed node used to be swallowed silently, leaving the
node stuck and the agent falsely told it had succeeded.)

### 12 · Do not pretend the last step is pending

```
skip_action(node_key="act_log_claim",
  reason="Nothing to log: the dispute was never accepted by the carrier.")
```

Leaving it at not_started would read as work still coming. It is not coming.

### Close it out

```
finish_run(status="failed",
  message="Dispute DSP-4471 is fully prepared (USD 6,300 recoverable, evidence attached) but could not be submitted: MSC portal credentials expired 28-AUG. A human needs to rotate the stored secret, then this run can be replayed from act_submit_dispute.")
```

Attach the finished dispute so the work is not lost:
```
attach_artifact(name="Dispute DSP-4471 (prepared, unsubmitted)", type="text",
  text="Container MSCU-4471820 · Invoice DEM-77120 USD 10,500 · Recoverable USD 6,300\nBasis: terminal gate log vs carrier discharge date, 3 days billed inside contractual free time (MX-2026-118 cl. 7.2).")
```

## What to look for on screen

- Ten green nodes, then one red — the failure is located, not diffuse
- Two attempts on the same node
- A skipped node that is honestly grey rather than misleadingly pending
- A closing message a person could act on without opening a log file
