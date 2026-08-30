"""Genera events.berrios-op4471-v2.jsonl — Land Pickup Handoff (BERU-40022).

El caso v2 del pitch: el trucking partner cancela el pickup, el sistema
propone fechas, TODAS fallan al confirmar, se buscan carriers alternos, el
humano decide dos veces (fecha sin dinero, carrier con dinero), se ejecuta,
y el flujo se BIFURCA: el original queda como referencia y el watch retoma
sobre el nuevo. Títulos <=5 palabras, findings de una línea cada uno.
Basado en docs del guion: berrios-demo-script.md. Regenerar, nunca editar
el JSONL a mano.
"""
import hashlib
import json
from datetime import datetime, timedelta, timezone

OUT = "events.berrios-op4471-v2.jsonl"
RUN_KEY = "berrios-op4471-v2"
T0 = datetime(2026, 8, 29, 14, 10, 4, tzinfo=timezone.utc)
PACE = 0.95

events = []
clock = 0.0


def stamp(offset):
    return (T0 + timedelta(seconds=offset)).isoformat().replace("+00:00", "+00:00")


def emit(event_type, payload, node_key=None, agent=None, advance=0.0):
    global clock
    clock += advance * PACE
    idem = hashlib.sha256(
        f"{event_type}:{node_key}:{len(events)}:{RUN_KEY}".encode()
    ).hexdigest()
    events.append({
        "sequence": len(events) + 1,
        "event_type": event_type,
        "occurred_at": stamp(clock),
        "agent_label": agent if node_key else None,
        "node_key": node_key,
        "idempotency_key": idem,
        "payload": payload,
    })


# ── the cast ────────────────────────────────────────────────────────────────
AGENT = {
    "ambient_ingest": "Nina",
    "ambient_identify": "Nina",
    "ambient_monitor": "Nina",
    "detect_pickup_email": "Nina",
    "decide_new_date": "Nina",
    "reconcile_confirmations": "Theo",
    "explain_notify_email": "Rex",
    "quantify_demurrage": "Rex",
    "plan_carriers": "Rex",
    "decide_carrier": "Rex",
    "act_confirm_email": "Lex",
    "fork_flow": "Nina",
    "trigger_new_plan": "Nina",
    "act_pay_record": "Lex",
}

AMBIENT = [
    ("ambient_ingest", "Ingest every carrier feed"),
    ("ambient_identify", "Match updates to operations"),
    ("ambient_monitor", "Keep a live picture"),
]

STEPS = [
    ("detect_pickup_email", "Pickup canceled", 8),
    ("decide_new_date", "Pick a new date", 10),
    ("reconcile_confirmations", "Confirm the date", 18),
    ("explain_notify_email", "Notify accountable party", 10),
]

EDGES = [
    ("detect_pickup_email", "decide_new_date"),
    ("decide_new_date", "reconcile_confirmations"),
    ("reconcile_confirmations", "explain_notify_email"),
]

# Attempt 2 - declared only AFTER the first plan dies. The flow does not
# patch over the failure: it visibly restarts from a new trigger card.
STEPS2 = [
    ("trigger_new_plan", "Restart: new plan", 6),
    ("quantify_demurrage", "Cost clock running", 12),
    ("plan_carriers", "Find alternate carriers", 16),
    ("decide_carrier", "Pick a carrier", 10),
    ("act_confirm_email", "Confirm with carrier", 10),
    ("act_pay_record", "Pay and record", 10),
]

EDGES2 = [
    ("trigger_new_plan", "quantify_demurrage"),
    ("quantify_demurrage", "plan_carriers"),
    ("plan_carriers", "decide_carrier"),
    ("decide_carrier", "act_confirm_email"),
]

emit("run_started", {
    "run_key": RUN_KEY,
    "name": "Trucking partner canceled the pickup for BERU-40022",
    "client_name": "Mueblerías Berríos — Puerto Rico",
    "scenario": "berrios-op4471-v2",
    "provider": "Nauta",
    "agents": [
        {"label": "Nina", "role": "Shipment Watch"},
        {"label": "Theo", "role": "Freight Anomaly"},
        {"label": "Rex", "role": "Root Cause"},
        {"label": "Lex", "role": "Expedite Communication"},
    ],
})

for key, label in AMBIENT:
    emit("node_added", {"label": label, "planned": False},
         node_key=key, agent="Nina", advance=0.06)

for a, b in [("ambient_ingest", "ambient_identify"),
             ("ambient_identify", "ambient_monitor")]:
    emit("edge_added", {
        "edge_key": f"{a}-to-{b}", "source_node_key": a, "target_node_key": b,
        "planned": False,
    }, advance=0.04)

for (key, _), minutes, finding in zip(AMBIENT, (3, 2, 4), (
    "Every trucking and port feed for BERU-40022 is read as it arrives.",
    "Each message lands on the right operation instantly.",
    "Pickup schedule watched; the next miss triggers below.",
)):
    emit("node_status_changed", {
        "status": "succeeded",
        "headline": "Ambient — running continuously",
        "finding": finding,
        "manual_minutes": minutes,
    }, node_key=key, agent="Nina", advance=0.5)

emit("plan_declared", {
    "graph_revision": 1,
    "proposed": True,
    "revisable": True,
    "basis": "Land Pickup Handoff — Berríos published automation",
    "plan": {
        "graph_revision": 1,
        "basis": "Land Pickup Handoff — Berríos published automation",
        "summary": "Replace the canceled pickup before the demurrage clock does real damage.",
        "steps": [
            {"node_key": k, "agent_label": AGENT[k], "label": lbl, "estimated_seconds": s}
            for k, lbl, s in STEPS
        ],
        "edges": [
            {"edge_key": f"{a}-to-{b}", "source_node_key": a, "target_node_key": b}
            for a, b in EDGES
        ],
    },
    "total_estimated_seconds": sum(s for _, _, s in STEPS),
}, advance=8.5)

for i, (key, label, secs) in enumerate(STEPS, start=1):
    emit("node_added", {
        "label": label, "estimated_seconds": secs, "planned": True, "plan_order": i,
    }, node_key=key, agent=AGENT[key], advance=0.08)

emit("edge_added", {
    "edge_key": "ambient_monitor-to-detect_pickup_email",
    "source_node_key": "ambient_monitor",
    "target_node_key": "detect_pickup_email",
    "planned": False,
}, advance=0.05)

for a, b in EDGES:
    emit("edge_added", {
        "edge_key": f"{a}-to-{b}", "source_node_key": a, "target_node_key": b, "planned": True,
    }, advance=0.05)


def start(key, advance=1.4, input_summary=None):
    payload = {"status": "in_progress", "started_at": stamp(clock + advance * PACE)}
    if input_summary:
        payload["input_summary"] = input_summary
    emit("node_status_changed", payload, node_key=key, agent=AGENT[key], advance=advance)


def progress(key, message, percent, advance=2.6):
    emit("node_updated", {"message": message, "progress_percent": percent},
         node_key=key, agent=AGENT[key], advance=advance)


def done(key, headline, finding=None, manual_minutes=None, metrics=None, advance=2.2):
    payload = {"status": "succeeded", "headline": headline}
    if finding:
        payload["finding"] = finding
    if manual_minutes is not None:
        payload["manual_minutes"] = manual_minutes
    if metrics:
        payload["metrics"] = metrics
    emit("node_status_changed", payload, node_key=key, agent=AGENT[key], advance=advance)


# ── 1 · DETECT · the email lands ────────────────────────────────────────────
start("detect_pickup_email", advance=2.0,
      input_summary="Email from trucking partner — BERU-40022")
progress("detect_pickup_email", "Urgent email matched to BERU-40022", 60, advance=2.6)
emit("artifact_added", {
    "artifact_type": "text",
    "message_id": "MSG-BERU-3301",
    "name": "Email — pickup canceled",
    "text_content": (
        "To: ops@nauta.ai\n"
        "From: dispatch@sanjuanhaul.example\n"
        "Date: 29 Aug 2026 14:10 UTC\n"
        "Subject: BERU-40022 — can't make the scheduled pickup\n\n"
        "Dear Nauta Operations,\n\n"
        "We regret to inform you that we cannot make the scheduled pickup for "
        "container BERU-40022 at San Juan port. Our truck assignment for that "
        "window fell through.\n\n"
        "Please advise on rescheduling.\n\n"
        "Kind regards,\n"
        "Dispatch — San Juan Haulage Co."
    ),
}, node_key="detect_pickup_email", agent="Nina", advance=2.4)
done("detect_pickup_email",
     "Pickup canceled — BERU-40022",
     "The trucking partner dropped the scheduled pickup. "
     "Container is at San Juan port; the clock starts now.",
     manual_minutes=8, advance=2.2)

# ── 2 · DECIDE (gate 1, no money) · pick a new date ─────────────────────────
start("decide_new_date", advance=1.4)
emit("intervention_requested", {
    # type 'choice': a scheduling pick, not a branching decision — choosing
    # any option must keep playing THIS recording (all three dates fail).
    "type": "choice",
    "prompt": "The pickup was dropped. Three windows are open — pick one:",
    "options": [
        {"id": "date-sep2", "label": "Tue Sep 2 — morning window, $0",
         "rationale": "Earliest open window at the port.",
         "rank": 1, "branch": "date-sep2", "maximum_cost_usd": 0},
        {"id": "date-sep3", "label": "Wed Sep 3 — afternoon window, $0",
         "rationale": "One buffer day, same cost.",
         "rank": 2, "branch": "date-sep3", "maximum_cost_usd": 0},
        {"id": "date-sep4", "label": "Thu Sep 4 — morning window, $0",
         "rationale": "Latest option before demurrage bites.",
         "rank": 3, "branch": "date-sep4", "maximum_cost_usd": 0},
    ],
    "default_option_id": "date-sep2",
}, node_key="decide_new_date", agent="Nina", advance=2.0)
emit("agent_message", {
    "message": "Nina is holding the reschedule until you pick a window.",
}, node_key="decide_new_date", agent="Nina", advance=6.0)
emit("intervention_resolved", {
    "option_id": "date-sep2",
    "branch_id": "date-sep2",
    "used_default": False,
}, node_key="decide_new_date", agent="Nina", advance=4.0)
done("decide_new_date",
     "Window picked — confirming it",
     "Chosen window handed to Theo to confirm with the partner.",
     manual_minutes=5, advance=1.6)

# ── 3 · RECONCILE · every date fails ────────────────────────────────────────
start("reconcile_confirmations", advance=1.2)
progress("reconcile_confirmations", "Confirming the picked window with the partner…", 25, advance=3.0)
progress("reconcile_confirmations", "Sep 2: unavailable. Trying Sep 3…", 50, advance=3.0)
progress("reconcile_confirmations", "Sep 3: unavailable. Trying Sep 4…", 75, advance=3.0)
emit("node_status_changed", {
    "status": "failed",
    "headline": "All 3 dates failed",
    "finding": "Sep 2, Sep 3 and Sep 4: all declined. "
               "The partner cannot serve this container this week.",
    "error_message": "The plan died here: the partner declined every window.",
    "manual_minutes": 20,
}, node_key="reconcile_confirmations", agent="Theo", advance=2.8)

# ── 4 · EXPLAIN · notify the accountable party ──────────────────────────────
start("explain_notify_email", advance=1.2)
progress("explain_notify_email", "Drafting the failure notice…", 50, advance=2.4)
emit("artifact_added", {
    "artifact_type": "text",
    "message_id": "MSG-BERU-3302",
    "name": "Email — no window could be confirmed",
    "text_content": (
        "To: dispatch@sanjuanhaul.example; ops.lead@muebleriasberrios.pr\n"
        "From: rex@ops.nauta.ai\n"
        "Date: 29 Aug 2026 14:16 UTC\n"
        "Subject: BERU-40022 — none of the proposed windows confirmed\n\n"
        "Dear all,\n\n"
        "Please be advised that none of the three proposed pickup windows "
        "(Sep 2, Sep 3, Sep 4) could be confirmed with the current partner.\n\n"
        "We are sourcing alternate carriers now and will present ranked "
        "options shortly. The demurrage clock on BERU-40022 is running.\n\n"
        "Kind regards,\n"
        "Rex — Root Cause Analysis, Nauta"
    ),
}, node_key="explain_notify_email", agent="Rex", advance=2.6)
done("explain_notify_email",
     "Failure notice sent",
     "Partner and ops lead informed: no window held. Alternates in motion.",
     manual_minutes=12, advance=2.0)

# ── the plan died: ask Nina, declare a NEW plan below ───────────────────────
emit("agent_message", {
    "message": "Asking Nina for a new solution…",
}, node_key="explain_notify_email", agent="Nina", advance=3.0)

emit("plan_declared", {
    "graph_revision": 2,
    "proposed": True,
    "revisable": True,
    "basis": "restart after confirmation failure — alternate carrier plan",
    "plan": {
        "graph_revision": 2,
        "basis": "restart after confirmation failure — alternate carrier plan",
        "summary": "The partner is out. New plan: price the clock, rank carriers, book one.",
        "steps": [
            {"node_key": k, "agent_label": AGENT[k], "label": lbl, "estimated_seconds": sec}
            for k, lbl, sec in STEPS2
        ],
        "edges": [
            {"edge_key": f"{a}-to-{b}", "source_node_key": a, "target_node_key": b}
            for a, b in EDGES2
        ],
    },
    "total_estimated_seconds": sum(sec for _, _, sec in STEPS2),
}, advance=2.2)

for i, (key, label, sec) in enumerate(STEPS2, start=1):
    emit("node_added", {
        "label": label, "estimated_seconds": sec, "planned": True, "plan_order": len(STEPS) + i,
    }, node_key=key, agent=AGENT[key], advance=0.08)

emit("edge_added", {
    "edge_key": "explain_notify_email-to-trigger_new_plan",
    "source_node_key": "explain_notify_email",
    "target_node_key": "trigger_new_plan",
    "planned": False,
}, advance=0.05)
for a, b in EDGES2:
    emit("edge_added", {
        "edge_key": f"{a}-to-{b}", "source_node_key": a, "target_node_key": b, "planned": True,
    }, advance=0.05)

# ── 1 (again) · the restart trigger — this is where it starts over ─────────
start("trigger_new_plan", advance=1.4)
done("trigger_new_plan",
     "Attempt 2 starts here",
     "Nina reset the flow: same container, fresh plan, the old one on file.",
     manual_minutes=4, advance=2.0)

# ── 5 · IMPACT · the demurrage clock ────────────────────────────────────────
start("quantify_demurrage", advance=1.2)
progress("quantify_demurrage", "Pricing every idle day at the port…", 50, advance=2.6)
done("quantify_demurrage",
     "Demurrage accruing — $150/day",
     "BERU-40022 sits at San Juan port at $150 per day. "
     "Three more idle days cost $450; a slow reschedule costs more than a premium truck.",
     manual_minutes=15,
     metrics={"demurrage_per_day_usd": 150, "days_at_risk": 3},
     advance=2.6)

# ── 6 · PLAN · alternate carriers, ranked ───────────────────────────────────
start("plan_carriers", advance=1.2)
progress("plan_carriers", "Carrier A: $480, pickup Sep 3", 33, advance=2.6)
progress("plan_carriers", "Carrier B: $610, pickup Sep 2", 66, advance=2.6)
done("plan_carriers",
     "Carrier A beats the clock",
     "Carrier A: $480, Sep 3. Carrier B: $610, Sep 2. Carrier C: $395, Sep 8 "
     "— cheapest on paper, but 5 extra days of demurrage erase the saving.",
     manual_minutes=18, advance=2.6)

# ── 7 · DECIDE (gate 2, money) · pick a carrier ─────────────────────────────
start("decide_carrier", advance=1.4)
emit("intervention_requested", {
    "type": "steer",
    "prompt": "The partner is out. Three carriers can take BERU-40022 — your call:",
    "options": [
        {"id": "carrier-a", "label": "Carrier A — pickup Sep 3, $480",
         "rationale": "Cheapest option that still beats the demurrage clock.",
         "rank": 1, "branch": "carrier-a", "maximum_cost_usd": 480},
        {"id": "carrier-b", "label": "Carrier B — pickup Sep 2, $610",
         "rationale": "A day earlier, at a premium the schedule does not require.",
         "rank": 2, "branch": "carrier-b", "maximum_cost_usd": 610},
        {"id": "carrier-c", "label": "Carrier C — pickup Sep 8, $395",
         "rationale": "Cheapest sticker price; 5 idle days of demurrage make it the dearest.",
         "rank": 3, "branch": "carrier-c", "maximum_cost_usd": 395},
    ],
    "default_option_id": "carrier-a",
}, node_key="decide_carrier", agent="Rex", advance=2.2)
emit("agent_message", {
    "message": "Rex is holding the booking — Carrier A's Sep 3 slot is first come, first served.",
}, node_key="decide_carrier", agent="Rex", advance=7.0)
emit("intervention_resolved", {
    "option_id": "carrier-a",
    "branch_id": "carrier-a",
    "used_default": False,
}, node_key="decide_carrier", agent="Rex", advance=5.0)
done("decide_carrier",
     "Carrier A approved — $480",
     "Sep 3 pickup at $480: beats the clock, saves the schedule.",
     manual_minutes=8, advance=1.8)

# ── 8 · ACT · confirm with the carrier ──────────────────────────────────────
start("act_confirm_email", advance=1.2)
progress("act_confirm_email", "Confirming the new terms with Carrier A…", 50, advance=2.4)
emit("artifact_added", {
    "artifact_type": "text",
    "message_id": "MSG-BERU-3303",
    "name": "Email — pickup confirmed with Carrier A",
    "text_content": (
        "To: bookings@carrier-a.example\n"
        "From: lex@ops.nauta.ai\n"
        "Date: 29 Aug 2026 14:24 UTC\n"
        "Subject: BERU-40022 — pickup confirmed, Sep 3, $480\n\n"
        "Dear Carrier A Bookings,\n\n"
        "We hereby confirm the pickup of container BERU-40022 at San Juan "
        "port on Sep 3, at the agreed rate of $480 all-in.\n\n"
        "Terminal reference and release documents follow in a separate "
        "message. Please acknowledge the booking.\n\n"
        "Kind regards,\n"
        "Lex — Expedite Communication, Nauta"
    ),
}, node_key="act_confirm_email", agent="Lex", advance=2.6)
done("act_confirm_email",
     "Pickup booked — Sep 3, $480",
     "Carrier A confirmed. The container moves before demurrage does damage.",
     manual_minutes=12, advance=2.0)

# ── 8.1 · FORK · the flow splits, the original stays ────────────────────────
emit("node_added", {"label": "Flow forked", "planned": False},
     node_key="fork_flow", agent="Nina", advance=1.2)
emit("edge_added", {
    "edge_key": "act_confirm_email-to-fork_flow",
    "source_node_key": "act_confirm_email",
    "target_node_key": "fork_flow",
    "planned": False,
}, advance=0.4)
emit("edge_added", {
    "edge_key": "fork_flow-to-act_pay_record",
    "source_node_key": "fork_flow",
    "target_node_key": "act_pay_record",
    "planned": False,
}, advance=0.3)
emit("node_status_changed", {"status": "in_progress", "started_at": stamp(clock + 0.5)},
     node_key="fork_flow", agent="Nina", advance=0.5)
done("fork_flow",
     "New flow live — original kept",
     "The dead plan is closed as a reference record, never overwritten. "
     "A fresh flow carries the Sep 3 pickup; the watch resumes on it.",
     manual_minutes=6, advance=2.4)

# ── 9 · ACT (financial) · pay and record ────────────────────────────────────
start("act_pay_record", advance=1.2)
progress("act_pay_record", "Paying Carrier A and writing the audit trail…", 50, advance=2.6)
emit("artifact_added", {
    "artifact_type": "text",
    "message_id": "MSG-BERU-3304",
    "name": "Receipt — Carrier A payment",
    "text_content": (
        "PAYMENT RECORD\n\n"
        "Payee:        Carrier A (San Juan drayage)\n"
        "Amount:       USD 480.00\n"
        "Container:    BERU-40022\n"
        "Service:      Port pickup — Sep 3\n"
        "References:   New flow (live) + original flow (reference)\n"
        "Copied to:    accounting@muebleriasberrios.pr\n\n"
        "Recorded for audit — Nauta Operations."
    ),
}, node_key="act_pay_record", agent="Lex", advance=2.4)
done("act_pay_record",
     "Paid and recorded — $480",
     "Payment out, receipt with both flow references sent to Accounting.",
     manual_minutes=10,
     metrics={"value_protected_usd": 450},
     advance=2.2)

emit("run_finished", {
    "summary": {
        "headline": "BERU-40022 rescued — picked up Sep 3",
        "detail": (
            "The trucking partner dropped the pickup and every proposed window "
            "failed. Nauta sourced three carriers, the operator approved the one "
            "that beats the demurrage clock, and the flow forked: the dead plan "
            "stays on file, the live one is back under the ambient watch. "
            "Berríos runs this watch across its whole book — the published case "
            "reports $3M/yr less demurrage and 65% less manual work."
        ),
    },
}, advance=2.0)

with open(OUT, "w", encoding="utf-8", newline="\n") as fh:
    for event in events:
        fh.write(json.dumps(event, ensure_ascii=False) + "\n")

print(f"{len(events)} events, {clock:.1f}s of wall clock -> {OUT}")

# ── check ───────────────────────────────────────────────────────────────────
with open(OUT, encoding="utf-8") as fh:
    lines = [json.loads(line) for line in fh]
assert [e["sequence"] for e in lines] == list(range(1, len(lines) + 1)), "sequences not 1..N"
assert sum(e["event_type"] == "intervention_requested" for e in lines) == 2, "expected 2 gates"
assert sum(e["event_type"] == "intervention_resolved" for e in lines) == 2, "expected 2 resolutions"
gate1 = next(e for e in lines if e["event_type"] == "intervention_requested" and e["node_key"] == "decide_new_date")
assert gate1["payload"]["type"] == "choice", "gate 1 must be a non-branching choice"
gate2 = next(e for e in lines if e["event_type"] == "intervention_requested" and e["node_key"] == "decide_carrier")
assert gate2["payload"]["type"] == "steer", "gate 2 must be a branching steer"
artifacts = [e for e in lines if e["event_type"] == "artifact_added"]
assert len(artifacts) == 4, "expected 4 artifacts"
fork = next(e for e in lines if e["node_key"] == "fork_flow" and e["payload"].get("status") == "succeeded")
assert "reference" in fork["payload"]["finding"], "fork must state the original is kept"
dones = [e for e in lines if e["event_type"] == "node_status_changed"
         and e["payload"].get("status") == "succeeded"]
assert all("manual_minutes" in e["payload"] for e in dones), "a done is missing manual_minutes"
failed = next(e for e in lines if e["payload"].get("status") == "failed")
assert failed["node_key"] == "reconcile_confirmations", "the failure lives on reconcile"
plans = [e for e in lines if e["event_type"] == "plan_declared"]
assert len(plans) == 2, "expected the restart to declare a second plan"
restart = next(e for e in lines if e["node_key"] == "trigger_new_plan" and e["event_type"] == "node_added")
assert restart["sequence"] > failed["sequence"], "attempt 2 must not exist before the failure"
finished = [e for e in lines if e["event_type"] == "run_finished"]
assert len(finished) == 1 and "3M" in finished[0]["payload"]["summary"]["detail"]
print(f"check ok: {len(lines)} lines, 2 gates (choice + steer), 4 artifacts, "
      f"fork keeps the original, {len(dones)} dones with manual_minutes")
