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
     "MSC swapped the vessel and re-routed OP-4471",
     "Schedule change notice from MSC: vessel MSC ALLEGRA replaced by MSC "
     "VITTORIA, with an added transshipment call at Caucedo. Booking-level "
     "change, caught against the last known schedule — nobody had to go looking.",
     manual_minutes=6, advance=3.4)

# ── 2 · RECONCILE · Theo — what actually changed vs. what was agreed ────────
RC = [
    sub("pull_booking", "Pull the original booking confirmation"),
    sub("compare_etd", "Compare ETD and assigned vessel"),
    sub("compare_eta", "Compare ETA at San Juan"),
    sub("compare_ts", "Compare transshipment ports"),
]
def rc(states):
    return [dict(s, status=st) for s, st in zip(RC, states)]

start("reconcile_booking", rc(["running", "pending", "pending", "pending"]),
      advance=1.4, input_summary="booking_confirmation_OP-4471.pdf")
progress("reconcile_booking", "Original booking on file: MSC ALLEGRA, direct via Freeport", 25,
         rc(["done", "running", "pending", "pending"]), advance=3.2)
progress("reconcile_booking", "ETD slips 2 days: Sep 4 to Sep 6, new vessel MSC VITTORIA", 50,
         rc(["done", "done", "running", "pending"]), advance=3.0)
progress("reconcile_booking", "ETA San Juan slips Oct 2 to Oct 8", 75,
         rc(["done", "done", "done", "running"]), advance=3.0)
done("reconcile_booking",
     "New routing lands 6 days late",
     "Agreed: MSC ALLEGRA, ETD Xiamen Sep 4, ETA San Juan Oct 2, one "
     "transshipment at Freeport. Now: MSC VITTORIA, ETD Sep 6, ETA Oct 8, "
     "with an added call at Caucedo. Every difference is carrier-side.",
     manual_minutes=18, subtasks=rc(["done"] * 4), advance=3.8)

# ── 3 · EXPLAIN · Rex — optimization or disruption? ─────────────────────────
start("explain_change", advance=1.4)
progress("explain_change", "No port disruption or weather advisory on the lane", 40, advance=3.0)
progress("explain_change", "MSC service bulletin: Caribbean calls consolidated onto VITTORIA", 75, advance=2.8)
done("explain_change",
     "Carrier network optimization, not a disruption",
     "MSC consolidated its Caribbean calls onto MSC VITTORIA via Caucedo — a "
     "scheduled network change, not a port closure or weather event. Nothing "
     "on Berrios' side caused it, and nothing suggests further slippage.",
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
progress("quantify_impact", "3 POs on this booking: PO-7712, PO-7738, PO-7741", 30,
         im(["done", "running", "pending"]), advance=3.2)
progress("quantify_impact", "PO-7741 is tied to a committed store delivery on Oct 6", 65,
         im(["done", "done", "running"]), advance=3.0)
done("quantify_impact",
     "6-day slip, 3 POs hit, 1 committed delivery at risk",
     "ETA slips 6 days, past the 5-day gate threshold. Three POs are on the "
     "booking, and PO-7741 feeds a committed store delivery on Oct 6 that the "
     "new Oct 8 arrival would miss. This crosses the line: a human decides.",
     manual_minutes=22,
     metrics={"eta_slip_days": 6, "affected_pos": 3, "committed_deliveries_at_risk": 1},
     subtasks=im(["done"] * 3), advance=3.8)

# ── 5 · PLAN · Rex — ranked options for the gate ────────────────────────────
PL = [
    sub("opt_notify", "Price notifying only"),
    sub("opt_reroute", "Price the alternative routing"),
    sub("opt_hold", "Price holding for client confirmation"),
]
def pl(states):
    return [dict(s, status=st) for s, st in zip(PL, states)]

start("plan_options", pl(["running", "pending", "pending"]), advance=1.4)
progress("plan_options", "Notify only: honest, but Oct 8 misses the committed delivery", 33,
         pl(["done", "running", "pending"]), advance=3.0)
progress("plan_options", "MSC direct service skips Caucedo: ETA Oct 3, $0 to amend", 66,
         pl(["done", "done", "running"]), advance=3.0)
done("plan_options",
     "Three options, one recovers the ETA at no cost",
     "Re-book onto MSC's direct San Juan service at $0 (ETA Oct 3, recovers 5 "
     "of the 6 days), notify the client and accept Oct 8, or hold everything "
     "for client confirmation. Ranked and ready for the gate.",
     manual_minutes=16, subtasks=pl(["done"] * 3), advance=3.6)

# ── 6 · DECIDE · the human gate — impact crossed the threshold ──────────────
start("decide_response", advance=1.4)
emit("intervention_requested", {
    "type": "steer",
    "prompt": "The 6-day slip crosses the 5-day threshold and PO-7741 has a committed Oct 6 store delivery. How should Nauta respond to MSC's change?",
    "options": [
        {"id": "alternative-routing", "label": "Re-book the alternative routing - direct service, ETA Oct 3, $0",
         "rationale": "Recovers 5 of the 6 days, protects the committed delivery, and costs nothing to amend.",
         "rank": 1, "branch": "alternative-routing", "maximum_cost_usd": 0},
        {"id": "notify-only", "label": "Notify the client of the new Oct 8 ETA - no re-booking",
         "rationale": "Zero operational risk, but the committed Oct 6 delivery on PO-7741 is missed.",
         "rank": 2, "branch": "notify-only", "maximum_cost_usd": 0},
        {"id": "hold-for-client", "label": "Hold and ask the client before acting",
         "rationale": "Maximum deference, but the direct-service space may be gone by the time they answer.",
         "rank": 3, "branch": "hold-for-client", "maximum_cost_usd": 0},
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
     "Re-book onto the direct service at $0, new ETA Oct 3 - the committed "
     "Oct 6 delivery on PO-7741 holds.",
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
progress("act_notify_client", "Update drafted - change, fix, and new ETA in one email", 30,
         ac(["done", "running", "pending"]), advance=3.0)

emit("artifact_added", {
    "artifact_type": "text",
    "message_id": "MSG-OP4471-2201",
    "name": "Client update — OP-4471 re-routed",
    "text_content": (
        "To: imports@muebleriasberrios.pr\n"
        "From: ops-automation@berrios-nauta.pr\n"
        "Date: 29 Aug 2026 05:21 UTC\n"
        "Subject: OP-4471 - MSC vessel change resolved: re-routed, ETA Oct 3\n\n"
        "Hola equipo,\n\n"
        "MSC replaced the vessel on OP-4471 (MSC ALLEGRA -> MSC VITTORIA) and "
        "added a transshipment call at Caucedo, which would have moved arrival "
        "at San Juan from Oct 2 to Oct 8 - past the committed Oct 6 store "
        "delivery on PO-7741.\n\n"
        "We have already re-booked the operation onto MSC's direct San Juan "
        "service at no cost:\n\n"
        "  New routing: Xiamen -> San Juan, direct (no Caucedo call)\n"
        "  New ETD: Sep 6\n"
        "  New ETA San Juan: Oct 3\n"
        "  POs covered: PO-7712, PO-7738, PO-7741\n"
        "  Amendment cost: $0\n\n"
        "The Oct 6 delivery commitment on PO-7741 is protected. No action is "
        "needed on your side; we will confirm the new schedule as it holds.\n\n"
        "Nauta Operations"
    ),
}, node_key="act_notify_client", agent="Lex", advance=3.2)

progress("act_notify_client", "Sent - awaiting acknowledgement", 65,
         ac(["done", "done", "running"]), advance=2.8)

emit("agent_message", {
    "message": "Waiting on Berrios imports to acknowledge the new routing.",
}, node_key="act_notify_client", agent="Lex", advance=7.0)

done("act_notify_client",
     "Client notified - new ETA Oct 3 acknowledged",
     "Berrios imports acknowledged the re-route. Booking amendment confirmed "
     "by MSC at $0; OP-4471 drops back to the ambient watch under the new "
     "schedule, with Nina's monitor confirming the Oct 3 ETA holds.",
     manual_minutes=20, subtasks=ac(["done"] * 3), advance=5.2)

emit("run_finished", {
    "summary": {
        "headline": "OP-4471 re-routed before the client felt it",
        "detail": (
            "MSC's vessel swap would have landed OP-4471 six days late, with a "
            "committed store delivery at risk. The ambient watch caught it, the "
            "slip was quantified and gated to a human, and a $0 re-route "
            "recovered five of the six days - new ETA Oct 3. Berríos runs this "
            "ambient watch across its whole book — the published Nauta case "
            "study reports $3M/yr less demurrage and 65% less manual work."
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
assert sum(e["event_type"] == "artifact_added" for e in lines) == 1, "expected 1 artifact"
finished = [e for e in lines if e["event_type"] == "run_finished"]
assert len(finished) == 1 and "3M" in finished[0]["payload"]["summary"]["detail"]
dones = [e for e in lines if e["event_type"] == "node_status_changed"
         and e["payload"].get("status") == "succeeded"]
assert all("manual_minutes" in e["payload"] for e in dones), "a done is missing manual_minutes"
print(f"check ok: {len(lines)} valid JSON lines, sequences 1..{len(lines)}, "
      f"1 intervention, 1 artifact, {len(dones)} dones with manual_minutes, run_finished cites $3M")
