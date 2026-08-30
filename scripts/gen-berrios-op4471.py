"""Genera events.berrios-op4471.jsonl — Berrios OP-4471 vessel & routing change.

Above/Below the Line: Nina's three ambient tasks (ingest/identify/monitor) open
the run already done — they never stop, they just hand off. The seven
Below-the-Line steps (detect -> act) are the declared plan. El ritmo sale de
occurred_at: recordedSource espera la diferencia entre eventos consecutivos.
Todo el run dura ~105 s.
"""
import hashlib
import json
from datetime import datetime, timedelta, timezone

OUT = "events.berrios-op4471.jsonl"
RUN_KEY = "berrios-op4471"
T0 = datetime(2026, 8, 29, 5, 20, 4, tzinfo=timezone.utc)

events = []
clock = 0.0


def stamp(offset):
    return (T0 + timedelta(seconds=offset)).isoformat().replace("+00:00", "+00:00")


def emit(event_type, payload, node_key=None, agent=None, advance=0.0):
    global clock
    clock += advance
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


def sub(key, label, status="pending"):
    return {"key": key, "label": label, "status": status}


# ── the cast ────────────────────────────────────────────────────────────────
AGENT = {
    "ambient_ingest": "Nina",
    "ambient_identify": "Nina",
    "ambient_monitor": "Nina",
    "detect_schedule_change": "Nina",
    "reconcile_booking": "Theo",
    "explain_change": "Rex",
    "quantify_impact": "Rex",
    "plan_options": "Rex",
    "decide_response": "Rex",
    "act_notify_client": "Lex",
}

# ── Above the Line · ambient, running the whole time ────────────────────────
AMBIENT = [
    ("ambient_ingest", "Ingest every carrier feed for OP-4471"),
    ("ambient_identify", "Match each update to its operation"),
    ("ambient_monitor", "Keep a live picture of OP-4471"),
]

# ── Below the Line · the declared plan ──────────────────────────────────────
STEPS = [
    ("detect_schedule_change", "Detect the vessel and routing change", 10),
    ("reconcile_booking", "Reconcile against the original booking", 26),
    ("explain_change", "Explain why MSC made the change", 20),
    ("quantify_impact", "Quantify the impact", 24),
    ("plan_options", "Generate and rank response options", 20),
    ("decide_response", "Decide the response", 12),
    ("act_notify_client", "Send the client update", 24),
]

EDGES = [
    ("detect_schedule_change", "reconcile_booking"),
    ("reconcile_booking", "explain_change"),
    ("explain_change", "quantify_impact"),
    ("quantify_impact", "plan_options"),
    ("plan_options", "decide_response"),
    ("decide_response", "act_notify_client"),
]

emit("run_started", {
    "run_key": RUN_KEY,
    "name": "MSC changed the vessel and routing on OP-4471",
    "client_name": "Mueblerías Berríos — Puerto Rico",
    "scenario": "berrios-op4471",
    "provider": "Nauta",
    "agents": [
        {"label": "Nina", "role": "Shipment Watch"},
        {"label": "Theo", "role": "Freight Anomaly"},
        {"label": "Rex", "role": "Root Cause"},
        {"label": "Lex", "role": "Expedite Communication"},
    ],
})

# The ambient lane exists before any plan does: three unplanned nodes, already
# running since booking, marked done so the foreground flow can start from them.
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
    "Every MSC feed and document for OP-4471 has been pulled in since booking.",
    "Each incoming update is matched to its operation — nothing waits in a queue.",
    "Live schedule picture held for OP-4471; the next mismatch triggers below the line.",
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
    "basis": "provider's established workflow for carrier schedule changes",
    "plan": {
        "graph_revision": 1,
        "basis": "provider's established workflow for carrier schedule changes",
        "summary": "Establish what MSC actually changed on OP-4471, quantify the slip, and act before the client feels it.",
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
})

for i, (key, label, secs) in enumerate(STEPS, start=1):
    emit("node_added", {
        "label": label, "estimated_seconds": secs, "planned": True, "plan_order": i,
    }, node_key=key, agent=AGENT[key], advance=0.08)

# The handoff edge: the ambient watch is what makes the trigger possible.
emit("edge_added", {
    "edge_key": "ambient_monitor-to-detect_schedule_change",
    "source_node_key": "ambient_monitor",
    "target_node_key": "detect_schedule_change",
    "planned": False,
}, advance=0.05)

for a, b in EDGES:
    emit("edge_added", {
        "edge_key": f"{a}-to-{b}", "source_node_key": a, "target_node_key": b, "planned": True,
    }, advance=0.05)


def start(key, subtasks=None, advance=1.4, input_summary=None):
    payload = {"status": "in_progress", "started_at": stamp(clock + advance)}
    if input_summary:
        payload["input_summary"] = input_summary
    if subtasks is not None:
        payload["subtasks"] = subtasks
    emit("node_status_changed", payload, node_key=key, agent=AGENT[key], advance=advance)


def progress(key, message, percent, subtasks=None, advance=2.6):
    payload = {"message": message, "progress_percent": percent}
    if subtasks is not None:
        payload["subtasks"] = subtasks
    emit("node_updated", payload, node_key=key, agent=AGENT[key], advance=advance)


def done(key, headline, finding=None, manual_minutes=None, metrics=None,
         subtasks=None, advance=2.2):
    payload = {"status": "succeeded", "headline": headline}
    if finding:
        payload["finding"] = finding
    if manual_minutes is not None:
        payload["manual_minutes"] = manual_minutes
    if metrics:
        payload["metrics"] = metrics
    if subtasks is not None:
        payload["subtasks"] = subtasks
    emit("node_status_changed", payload, node_key=key, agent=AGENT[key], advance=advance)


# ── 1 · DETECT · Nina — the ambient watch surfaces the mismatch ─────────────
start("detect_schedule_change", advance=2.0,
      input_summary="MSC schedule change notification — OP-4471")
progress("detect_schedule_change",
         "Carrier notice does not match the last known schedule", 60, advance=2.8)
done("detect_schedule_change",
     "MSC pulled the assigned vessel off OP-4471",
     "Schedule change notice from MSC: MSC AURORA voyage FE2431 withdrawn "
     "from the rotation and reassigned. OP-4471 rolls to the carrier's "
     "fallback sailing. Booking-level change, caught against the last known "
     "schedule within minutes — nobody had to go looking.",
     manual_minutes=6, advance=3.4)

# ── 2 · RECONCILE · Theo — what actually changed vs. what was agreed ────────
RC = [
    sub("pull_booking", "Pull the original booking confirmation"),
    sub("compare_vessel", "Compare assigned vessel and voyage"),
    sub("compare_eta", "Compare ETA at San Juan"),
    sub("compare_ts", "Compare routing and transshipment"),
]
def rc(states):
    return [dict(s, status=st) for s, st in zip(RC, states)]

start("reconcile_booking", rc(["running", "pending", "pending", "pending"]),
      advance=1.4, input_summary="booking_confirmation_OP-4471.pdf")
progress("reconcile_booking", "Original booking on file: MSC AURORA FE2431, via Caucedo, ETA Sep 27", 25,
         rc(["done", "running", "pending", "pending"]), advance=3.2)
progress("reconcile_booking", "AURORA withdrawn - fallback vessel MSC VITTORIA FE2435, same rotation", 50,
         rc(["done", "done", "running", "pending"]), advance=3.0)
progress("reconcile_booking", "Fallback ETA San Juan slips Sep 27 to Oct 7", 75,
         rc(["done", "done", "done", "running"]), advance=3.0)
done("reconcile_booking",
     "Carrier's fallback lands 10 days late",
     "Agreed on booking BKG-4471: MSC AURORA FE2431, via Caucedo "
     "(transshipment), ETA San Juan Sep 27. Carrier's fallback: MSC VITTORIA "
     "FE2435 on the same Caucedo rotation, ETA Oct 7 — 10 days late. Every "
     "difference is carrier-side.",
     manual_minutes=18, subtasks=rc(["done"] * 4), advance=3.8)

# ── 3 · EXPLAIN · Rex — optimization or disruption? ─────────────────────────
start("explain_change", advance=1.4)
progress("explain_change", "No port disruption or weather advisory on the lane", 40, advance=3.0)
progress("explain_change", "MSC service bulletin: AURORA reassigned to another loop", 75, advance=2.8)
done("explain_change",
     "Carrier network optimization, not a disruption",
     "MSC reassigned MSC AURORA to another service loop and rolled its "
     "Caucedo rotation onto MSC VITTORIA — a scheduled capacity reshuffle, "
     "not a port closure or weather event. Nothing on Berrios' side caused "
     "it, and nothing suggests further slippage.",
     manual_minutes=20, advance=3.0)

# ── 4 · IMPACT · Rex — quantify before anyone asks ──────────────────────────
IM = [
    sub("map_pos", "Map the POs riding on OP-4471"),
    sub("check_commit", "Check committed delivery dates"),
    sub("size_slip", "Size the slip against the threshold"),
]
def im(states):
    return [dict(s, status=st) for s, st in zip(IM, states)]

start("quantify_impact", im(["running", "pending", "pending"]), advance=1.4)
progress("quantify_impact", "3 POs on this booking: PO-7731, PO-7745, PO-7752", 30,
         im(["done", "running", "pending"]), advance=3.2)
progress("quantify_impact", "PO-7731 is tied to a committed store delivery on Oct 10", 65,
         im(["done", "done", "running"]), advance=3.0)
done("quantify_impact",
     "10-day slip on the fallback, 3 POs hit, 1 committed delivery at risk",
     "The carrier's fallback slips the ETA 10 days (Sep 27 to Oct 7), past "
     "the 5-day gate threshold. Three POs ride on the booking: PO-7731 feeds "
     "a committed store delivery on Oct 10 that an Oct 7 arrival would miss "
     "once discharge and inland transit are counted; PO-7745 and PO-7752 "
     "carry no committed dates. This crosses the line: a human decides.",
     manual_minutes=22,
     metrics={"fallback_slip_days": 10, "affected_pos": 3, "committed_deliveries_at_risk": 1},
     subtasks=im(["done"] * 3), advance=3.8)

# ── 5 · PLAN · Rex — ranked options for the gate ────────────────────────────
PL = [
    sub("opt_accept", "Price accepting the carrier's fallback"),
    sub("opt_reroute", "Price the direct alternative routing"),
    sub("opt_transload", "Price a premium transload at Caucedo"),
]
def pl(states):
    return [dict(s, status=st) for s, st in zip(PL, states)]

start("plan_options", pl(["running", "pending", "pending"]), advance=1.4)
progress("plan_options", "Accept fallback: $0, but Oct 7 risks PO-7731's committed Oct 10 delivery", 33,
         pl(["done", "running", "pending"]), advance=3.0)
progress("plan_options", "MSC ILONA FE2440, direct San Juan: ETA Oct 3, $0 to amend", 66,
         pl(["done", "done", "running"]), advance=3.0)
done("plan_options",
     "Three options, one recovers 4 days at no cost",
     "Re-book onto MSC ILONA FE2440, direct San Juan, at $0 (ETA Oct 3 — "
     "holds the slip to 6 days vs the original booking, 4 better than the "
     "fallback); transload at Caucedo onto a feeder for ETA Oct 1 at +$2,400; "
     "or accept the carrier's fallback at Oct 7 and notify. Ranked and ready "
     "for the gate.",
     manual_minutes=16, subtasks=pl(["done"] * 3), advance=3.6)

# ── 6 · DECIDE · the human gate — impact crossed the threshold ──────────────
start("decide_response", advance=1.4)
emit("intervention_requested", {
    "type": "steer",
    "prompt": "The carrier's fallback slips OP-4471 ten days, past the 5-day threshold, and PO-7731 has a committed Oct 10 store delivery. How should Nauta respond to MSC's change?",
    "options": [
        {"id": "alternative-routing", "label": "Re-book MSC ILONA FE2440 - direct San Juan, ETA Oct 3, $0",
         "rationale": "Recovers 4 days vs the fallback, protects PO-7731's committed Oct 10 delivery, and costs nothing to amend.",
         "rank": 1, "branch": "alternative-routing", "maximum_cost_usd": 0},
        {"id": "premium-transload", "label": "Transload at Caucedo onto a feeder - ETA Oct 1, +$2,400",
         "rationale": "Two days better than the direct option, but adds cost and a handling risk the schedule does not require.",
         "rank": 2, "branch": "premium-transload", "maximum_cost_usd": 2400},
        {"id": "accept-fallback", "label": "Accept the carrier's fallback - ETA Oct 7, notify only",
         "rationale": "Zero effort, but Oct 7 arrival leaves PO-7731's committed Oct 10 delivery exposed to any further slip.",
         "rank": 3, "branch": "accept-fallback", "maximum_cost_usd": 0},
    ],
    "default_option_id": "alternative-routing",
}, node_key="decide_response", agent="Rex", advance=2.2)

emit("agent_message", {
    "message": "Rex is holding OP-4471 at the gate - the direct-service space is first come, first served.",
}, node_key="decide_response", agent="Rex", advance=8.0)

emit("intervention_resolved", {
    "option_id": "alternative-routing",
    "branch_id": "alternative-routing",
    "used_default": False,
}, node_key="decide_response", agent="Rex", advance=6.5)

done("decide_response",
     "Operator approved the alternative routing",
     "Re-book onto MSC ILONA FE2440, direct San Juan, at $0 - new ETA Oct 3, "
     "6 days vs the original booking and 4 better than the carrier's "
     "fallback. The committed Oct 10 delivery on PO-7731 holds.",
     manual_minutes=8, advance=2.0)

# ── 7 · ACT · Lex — the client hears about it once, already solved ──────────
AC = [
    sub("draft", "Draft the client update"),
    sub("send", "Send it to Berrios imports"),
    sub("confirm", "Record the acknowledgement"),
]
def ac(states):
    return [dict(s, status=st) for s, st in zip(AC, states)]

start("act_notify_client", ac(["running", "pending", "pending"]), advance=1.4)
progress("act_notify_client", "Update drafted - what changed, your orders, what we did", 30,
         ac(["done", "running", "pending"]), advance=3.0)

emit("artifact_added", {
    "artifact_type": "text",
    "message_id": "MSG-OP4471-2201",
    "name": "Client update — OP-4471 re-routed",
    "text_content": (
        "To: imports@muebleriasberrios.pr\n"
        "From: ops-automation@berrios-nauta.pr\n"
        "Date: 29 Aug 2026 05:21 UTC\n"
        "Subject: OP-4471 — vessel change resolved: new routing confirmed, "
        "ETA Oct 3 (no action needed)\n\n"
        "MSC reassigned the vessel on OP-4471; we secured direct alternative "
        "routing at no cost. New ETA San Juan: Oct 3.\n\n"
        "WHAT CHANGED\n"
        "  Original: MSC AURORA FE2431 · via Caucedo (transshipment) · ETA Sep 27\n"
        "  New:      MSC ILONA FE2440  · direct San Juan             · ETA Oct 3\n"
        "            (+6 days vs original booking, -4 vs carrier's fallback)\n\n"
        "YOUR ORDERS\n"
        "  PO-7731  committed delivery Oct 10 — holds\n"
        "  PO-7745  no committed date — unaffected\n"
        "  PO-7752  no committed date — unaffected\n\n"
        "WHAT WE DID\n"
        "  - Caught the change within minutes via continuous watch\n"
        "  - Evaluated 3 routing options; kept the one at $0 additional cost\n"
        "  - New BL and booking confirmation attached\n\n"
        "No action needed on your side. Reply to this thread if you want the "
        "alternative options we rejected.\n\n"
        "Lex — Expedite Communication, Nauta (for Mueblerías Berríos)\n"
        "Ref: booking BKG-4471-R2 · case CS-0830"
    ),
}, node_key="act_notify_client", agent="Lex", advance=3.2)

emit("artifact_added", {
    "artifact_type": "text",
    "message_id": "MSG-OP4471-2202",
    "name": "Booking confirmation — BKG-4471-R2",
    "text_content": (
        "MSC MEDITERRANEAN SHIPPING COMPANY\n"
        "BOOKING AMENDMENT CONFIRMATION\n\n"
        "Booking:        BKG-4471-R2 (amends BKG-4471)\n"
        "Vessel/Voyage:  MSC ILONA / FE2440\n"
        "POL:            Xiamen, CN — ETD 06 Sep 2026\n"
        "POD:            San Juan, PR — ETA 03 Oct 2026\n"
        "Routing:        Direct — no transshipment\n"
        "Equipment:      As per original booking BKG-4471\n"
        "Amendment fee:  USD 0.00\n"
        "B/L:            MSCUXM4471R2 — draft issued with this confirmation\n\n"
        "Space and equipment confirmed. Ref case CS-0830."
    ),
}, node_key="act_notify_client", agent="Lex", advance=2.4)

progress("act_notify_client", "Sent with BL and booking confirmation - awaiting acknowledgement", 65,
         ac(["done", "done", "running"]), advance=2.8)

emit("agent_message", {
    "message": "Waiting on Berrios imports to acknowledge the new routing.",
}, node_key="act_notify_client", agent="Lex", advance=7.0)

done("act_notify_client",
     "Client notified - new ETA Oct 3 acknowledged",
     "Berrios imports acknowledged the re-route. Booking BKG-4471-R2 "
     "confirmed by MSC at $0 with the new BL attached; OP-4471 drops back to "
     "the ambient watch under the new schedule, with Nina's monitor "
     "confirming the Oct 3 ETA holds.",
     manual_minutes=20, subtasks=ac(["done"] * 3), advance=5.2)

emit("run_finished", {
    "summary": {
        "headline": "OP-4471 re-routed before the client felt it",
        "detail": (
            "MSC pulled the assigned vessel off OP-4471; the carrier's "
            "fallback would have landed it ten days late, with PO-7731's "
            "committed Oct 10 store delivery at risk. The ambient watch caught "
            "it, the impact was gated to a human, and a $0 re-book onto a "
            "direct service held the slip to six days - new ETA Oct 3, the "
            "commitment intact. Berríos runs this ambient watch across its "
            "whole book — the published Nauta case study reports $3M/yr less "
            "demurrage and 65% less manual work."
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
started = [e for e in lines if e["event_type"] == "run_started"]
assert len(started) == 1 and started[0]["payload"]["client_name"] == "Mueblerías Berríos — Puerto Rico"
assert sum(e["event_type"] == "intervention_requested" for e in lines) == 1, "expected 1 intervention"
assert sum(e["event_type"] == "intervention_resolved" for e in lines) == 1, "expected 1 resolution"
artifacts = [e for e in lines if e["event_type"] == "artifact_added"]
assert len(artifacts) == 2, "expected 2 artifacts"
email = artifacts[0]["payload"]["text_content"]
for token in ("ETA Oct 3", "PO-7731", "PO-7745", "PO-7752", "BKG-4471-R2",
              "CS-0830", "MSC AURORA FE2431", "MSC ILONA FE2440", "+6 days"):
    assert token in email, f"email missing {token}"
assert "BKG-4471-R2" in artifacts[1]["payload"]["text_content"], "confirmation missing booking ref"
finished = [e for e in lines if e["event_type"] == "run_finished"]
assert len(finished) == 1 and "3M" in finished[0]["payload"]["summary"]["detail"]
dones = [e for e in lines if e["event_type"] == "node_status_changed"
         and e["payload"].get("status") == "succeeded"]
assert all("manual_minutes" in e["payload"] for e in dones), "a done is missing manual_minutes"
print(f"check ok: {len(lines)} valid JSON lines, sequences 1..{len(lines)}, "
      f"1 intervention, 2 artifacts, {len(dones)} dones with manual_minutes, run_finished cites $3M")
