# Client Example: Berríos — OP-4471 Vessel & Routing Change

> **This is the canonical demo case.** Any UI, content or recording work on the Berríos
> case follows THIS document — do not invent steps, agents, numbers or thresholds that
> are not here. Where it lives in code:
>
> - Run key: **`berrios-op4471`** (also the default run — `usedonald.com` opens on it)
> - Recording: `frontend/lib/donald/events.berrios-op4471.jsonl`
> - Generator: `scripts/gen-berrios-op4471.py` (regenerate the recording from here, never hand-edit the JSONL)
> - Two-stage UI mapping: `frontend/lib/donald/operational-stages.ts`, `frontend/lib/donald/action-presentation.ts`
>
> `land-pickup` (BERU-40022) is a DIFFERENT, older Berríos case kept as regression
> material. Do not mix the two: different operation, different numbers.

Runnable spec for one flow instance, restructured around the 2-stage operator model: **Above the Line** (ambient, continuous, no trigger) and **Below the Line** (targeted, triggered, sequential). Client and results are real (Nauta case study, getnauta.com/case-studies/berrios-demurrage). The specific operation, agent assignments, and event log are illustrative — built to match the reference screenshot's structure and Nauta's real named-agent roster.

## Client

- **Mueblerías Berríos** — Puerto Rico, 28 stores, major Ashley Furniture retailer, largest distribution center in Central America
- **Real results on file:** $3M/yr less on demurrage, 65% less manual work (32 monthly hours cut to roughly a third)
- **Where this sits:** Above the Line has been watching OP-4471 continuously since booking. This example is the moment that ambient watch surfaces something and Below the Line takes over.

## Above the Line — ambient, running the whole time

Not a numbered step in the flow below — this is a persistent background lane. No trigger required; the three tasks run in parallel and never stop, for this operation or any other.

| Agent | Task | What it does | Status |
|---|---|---|---|
| **Nina** — Shipment Watch | INGEST | Continuously pulls in every carrier feed and document for OP-4471 | `ambient` |
| **Nina** — Shipment Watch | IDENTIFY | Matches every incoming update to the right operation | `ambient` |
| **Nina** — Shipment Watch | MONITOR | Keeps a live picture of the operation's status | `ambient` |

This lane is what makes the trigger below possible — nobody had to go looking for the MSC change. It was already being watched for.

## Trigger — where Below the Line picks up

```
trigger: carrier_notice
source: MSC (carrier) — schedule change notification
operation: OP-4471
container: n/a (booking-level change, pre-container-specific impact)
```

MSC changes the assigned vessel and routing for OP-4471. Ambient MONITOR catches the mismatch against the last known schedule — that's the **DETECT** event, and it's what hands the operation from Above to Below the Line.

## Below the Line — triggered, sequential chain

DETECT is the entry point. Everything after it is triggered by the step before — this is the layer that produces a measurable, attributable outcome, which is why steps 3–5 are the ones that would carry an Impact Receipt in the full build.

| # | Agent | BTL task | Status (t=0) | What it does |
|---|-------|----------|---------------|--------------|
| 1 | **Nina** — Shipment Watch | DETECT | `done` | Flags the vessel/routing change as an exception against the last known schedule — the trigger event. |
| 2 | **Theo** — Freight Anomaly | RECONCILE | `running` | Compares the new vessel/routing against the original booking confirmation — establishes what actually changed (ETD, ETA, transshipment ports) vs. what was agreed. |
| 3 | **Rex** — Root Cause | EXPLAIN | `proposed` | Determines why the change happened — carrier-side schedule optimization vs. disruption. |
| 4 | **Rex** — Root Cause | IMPACT | `proposed` | Quantifies the consequence — days of ETA slip, affected POs, exposure if unresolved. |
| 5 | **Rex** — Root Cause | PLAN | `proposed` | Generates ranked response options: notify only / offer alternative routing / hold for client confirmation. *(Only runs if impact crosses the gate threshold — see below.)* |
| 6 | — fork — | DECIDE | `proposed` | Below threshold: proceeds autonomously, skip to step 7. Above threshold: holds for a human to pick from Rex's ranked options. |
| 7 | **Lex** — Expedite Communication | ACT | `proposed` | Drafts and sends the client-facing update reflecting whatever was decided — the "send an email" moment. |

After step 7, the operation drops back into the **Above the Line** lane — Nina's MONITOR resumes under the new schedule, confirming the new ETA holds.

**Note on agent assignment:** the reference screenshot assigns "assess impact" to Marcus (Inventory Watch in Nauta's real roster — a function mismatch for this task). Reassigned here to Rex (Root Cause), whose real published function fits EXPLAIN/IMPACT/PLAN directly. This grouping — one agent owning explain → impact → plan — is an illustrative choice, not a documented Nauta assignment.

## Human-in-the-loop moment

The gate sits at **DECIDE (step 6)**, between Rex's PLAN and Lex's ACT:

- **Below threshold** (e.g., ETA slip ≤ 5 days, no committed delivery date affected): DECIDE resolves autonomously, Lex proceeds to notify automatically.
- **Above threshold** (ETA slip > 5 days, or any affected PO tied to a committed customer delivery date): DECIDE holds — a human sees Rex's evidence (EXPLAIN + IMPACT) and Rex's ranked options (PLAN), picks one, and only then does Lex act.

## Expected UI per step

| Step | Renders as |
|---|---|
| ATL lane | Persistent ambient status strip — always visible, never blocks, shows Nina's three tasks running quietly |
| 1 — DETECT | Trace line + AlertBanner (exception detected) — this is what breaks the ambient strip into a foreground flow |
| 2 — RECONCILE | Document/data compare view — old booking vs. new schedule, mismatch highlighted |
| 3 — EXPLAIN | Evidence list — root cause |
| 4 — IMPACT | Cost/time impact stat block |
| 5 — PLAN | Ranked option cards (the three choices) |
| 6 — DECIDE | Escalation panel (only rendered if gated) — otherwise a silent trace line |
| 7 — ACT | Drafted email card, then a result/confirmation card once sent |
| return to ATL | Foreground flow collapses back into the ambient strip — operation drops off the urgent list |

## Sample event stream (for a live log / activity feed)

```
—         Nina: ingest — ambient
—         Nina: identify — ambient
—         Nina: monitor — ambient
05:20:04  Nina added evidence
05:20:04  Nina: MSC changed the vessel and routing
05:20:04  Nina changed detect status → done
05:20:07  Theo updated reconcile-booking
05:20:10  Theo changed reconcile-booking status → running
—         Rex: explain-change → proposed
—         Rex: quantify-impact → proposed
—         Rex: plan-options → proposed
—         DECIDE: gate check → proposed
—         Lex: send-update → proposed
—         Nina: monitor resumes (post-resolution) → ambient
```

## Real vs. illustrative — kept explicit on purpose

- **Real:** client identity, aggregate results, the three named Nauta automations this flow descends from (ETD/ETA Change Detection → DETECT/RECONCILE, general shipment monitoring → the Above the Line lane), Nauta's 20-agent naming convention and the specific real names Nina, Theo, Rex, Lex used here.
- **Illustrative:** the Above/Below the Line framing itself (an operator-facing model, not a Nauta term), operation ID OP-4471, the specific event log timestamps, the exact gate threshold, and every step-to-agent assignment beyond what's publicly documented (Nauta hasn't published which named agent handles which task at this granularity).
