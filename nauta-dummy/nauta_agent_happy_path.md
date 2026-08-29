# Use case 01 — Happy path: detention risk caught and cleared

**Scenario file for a demo agent.** Ask the agent to run the `donald-flow` skill and
work this scenario. It reports every step to the Donald MCP server; the graph is what
the audience watches.

- **run_key** — `nauta-detention-001`
- **Runtime** — ~4 minutes
- **Ends** — `finish_run(status="succeeded")`
- **Shows** — the full 12-stage pipeline, a parallel fan-out and a join, an autonomous
  decision inside policy, and a real dollar figure at the end

## The story

Three containers of footwear are moving Shanghai → Manzanillo for an importer. Overnight
the carrier reissues the schedule: the vessel is two days late. Two days is not
interesting on its own. It becomes interesting because container **MSCU-4471820** has only
**four free days** at destination, and a two-day slip eats all of them — putting the
container into detention at **$210/day**.

Nauta's agents notice before anyone opens their laptop, and reschedule the pickup so the
charge never happens.

## The cast

| Agent | Role |
|---|---|
| Nina | Shipment Watch |
| Theo | Freight Anomaly |
| Marcus | Inventory Watch |
| Alec | Contract Compliance |

Pass these as `agent_label` so the UI can lane them.

## The plan to declare

Declare all of this in one `declare_actions` call before doing any work. The whole shape
should be on screen before the first step turns green — that is the moment the audience
understands what they are looking at.

**Pass `agent_label` on every step** (the Agent column below) — it draws the swimlanes, and
without it the graph looks like one anonymous worker. **Use `depends_on: [...]` for the
joins** (steps 6 and 9 and 12 each wait on more than one predecessor); `after` only handles
a single parent. Declaring the joins properly here is what makes step 6 render as a real
three-way join instead of a line you patch up afterwards.

```
declare_actions(run_key="nauta-detention-001", actions=[
  {node_key: "ingest_carrier_update",      name: "Read carrier schedule update", agent_label: "Nina"},
  {node_key: "identify_shipments",         name: "Identify affected shipments",  agent_label: "Nina",
   after: "ingest_carrier_update"},
  {node_key: "extract_bill_of_lading",     name: "Extract bill of lading",       agent_label: "Theo",
   after: "identify_shipments"},
  {node_key: "extract_commercial_invoice", name: "Extract commercial invoice",   agent_label: "Theo",
   after: "identify_shipments"},
  {node_key: "extract_packing_list",       name: "Extract packing list",         agent_label: "Theo",
   after: "identify_shipments"},
  {node_key: "reconcile_sources",          name: "Reconcile against ERP booking", agent_label: "Theo",
   depends_on: ["extract_bill_of_lading", "extract_commercial_invoice", "extract_packing_list"]},
  ... and so on for steps 7-15, with depends_on on 9 and 12
])
```

| # | Stage | node_key | Label | Agent | ~sec | Depends on |
|---|---|---|---|---|---|---|
| 1 | INGEST | `ingest_carrier_update` | Read carrier schedule update | Nina | 8 | — |
| 2 | IDENTIFY | `identify_shipments` | Identify affected shipments | Nina | 12 | 1 |
| 3 | EXTRACT | `extract_bill_of_lading` | Extract bill of lading | Theo | 25 | 2 |
| 4 | EXTRACT | `extract_commercial_invoice` | Extract commercial invoice | Theo | 22 | 2 |
| 5 | EXTRACT | `extract_packing_list` | Extract packing list | Theo | 18 | 2 |
| 6 | RECONCILE | `reconcile_sources` | Reconcile against ERP booking | Theo | 30 | 3, 4, 5 |
| 7 | MONITOR | `monitor_free_time` | Track free days per container | Nina | 15 | 6 |
| 8 | PREDICT | `predict_arrival` | Forecast berth and gate-out | Nina | 28 | 6 |
| 9 | DETECT | `detect_detention_risk` | Flag containers at risk | Theo | 12 | 7, 8 |
| 10 | EXPLAIN | `explain_root_cause` | Determine root cause | Theo | 20 | 9 |
| 11 | IMPACT | `calculate_impact` | Cost and inventory impact | Marcus | 24 | 9 |
| 12 | PLAN | `plan_responses` | Generate and rank responses | Marcus | 26 | 10, 11 |
| 13 | DECIDE | `decide_response` | Decide within policy | Alec | 10 | 12 |
| 14 | ACT | `act_reschedule_pickup` | Reschedule pickup | Nina | 18 | 13 |
| 15 | ACT | `act_update_erp` | Write back to ERP | Nina | 14 | 13 |

**Two shapes worth pointing at during the demo.** Steps 3–5 fan out from IDENTIFY and run
in parallel — start all three before completing any, so the graph shows three lanes live
at once. Step 6 is a **join**: it waits on all three. That is exactly what the old
`from`/`to` columns on a node could not express, and why edges became their own entity.

Steps 7 and 8 are also parallel, joining at 9. Steps 14 and 15 fan out from the decision.

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

Report as you go, at roughly the durations above — a step that takes 28 seconds should
actually take about that long. **The duration is the intervention window:** a step that
finishes instantly gives nobody time to look at it, and makes the stop button decorative.

Post `report_progress` two or three times inside anything over 20 seconds.

### 1 · INGEST — `ingest_carrier_update`
> MSC reissued the schedule for AURORA FE2431. New ETA Manzanillo **07-SEP-2026**,
> previously 05-SEP. Routing unchanged.

Attach the source email:
```
attach_artifact(name="Schedule update — MSC AURORA FE2431", type="text",
  text="From: ops@msc.com\nSubject: Revised schedule — MSC AURORA FE2431\n\nRevised ETA Manzanillo 07-SEP-2026 (previously 05-SEP-2026).\nNo change to routing or vessel.")
```

### 2 · IDENTIFY — `identify_shipments`
> Three containers on this vessel belong to us: MSCU-4471820, MSCU-4471835, TGHU-8890114.
> All three are footwear POs for the autumn set.

### 3–5 · EXTRACT — three documents, in parallel
Start all three, then let them finish in a staggered order (packing list first, then
invoice, then BL) so the lanes visibly move at different speeds.

- `extract_bill_of_lading` → "BL MSCUXM2213 — 3 containers, 1,840 cartons, freight prepaid."
- `extract_commercial_invoice` → "Invoice CI-88213 — USD 412,900, Incoterm FOB Shanghai."
- `extract_packing_list` → "1,840 cartons across 14 SKUs. Gross 18,400 kg."

### 6 · RECONCILE — `reconcile_sources`
> Documents agree with the ERP booking on quantity, value and Incoterm. **One difference:
> the ERP still holds the old ETA.** That is the operational truth to correct.

### 7 & 8 · MONITOR and PREDICT — parallel
- `monitor_free_time` → "MSCU-4471820 has 4 free days. The other two have 7."
- `predict_arrival` → "Berthing 07-SEP 14:00, gate-out most likely 09-SEP. Confidence 0.82."

Give `predict_arrival` its full ~28s with progress lines — it is the step where the
audience should feel the agent actually working.

### 9 · DETECT — `detect_detention_risk`
> **MSCU-4471820 goes into detention on 13-SEP.** The two-day slip consumes its entire
> free-time buffer. The other two containers stay inside their window.

### 10 · EXPLAIN — `explain_root_cause`
> Vessel bunching at Manzanillo: three services berthing in the same 24h window. The
> carrier absorbed the delay at anchor, not in transit.

### 11 · IMPACT — `calculate_impact` (parallel with 10)
> Detention exposure **USD 1,260** (6 days × $210) if pickup is unchanged. No stockout
> risk: SKU cover is 22 days.

### 12 · PLAN — `plan_responses`
> Three options, ranked:
> 1. Reschedule pickup to 09-SEP — cost **$0**, clears the risk entirely
> 2. Buy 3 extra free days — cost **$450**
> 3. Do nothing and absorb — cost **$1,260**

### 13 · DECIDE — `decide_response`
> Option 1. **Inside policy**: no incremental cost, no service change, so no human gate
> required. Proceeding autonomously.

Say the policy check out loud — it is what makes autonomy legible instead of alarming.

### 14 & 15 · ACT — parallel
- `act_reschedule_pickup` → "Pickup moved to 09-SEP 08:00. Confirmation ND-77120."
- `act_update_erp` → "ERP updated: ETA 07-SEP, pickup 09-SEP, BL MSCUXM2213 attached."

### Finish
```
finish_run(status="succeeded",
  message="Detention risk on MSCU-4471820 cleared. USD 1,260 avoided at no cost.")
```

## What to look for on screen

- The whole plan appears greyed out before anything runs
- Three EXTRACT lanes live at once, finishing at different times
- The join at RECONCILE — one node waiting on three
- A dollar figure at the end that a logistics operator recognises as real money
