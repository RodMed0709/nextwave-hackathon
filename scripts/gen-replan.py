"""Genera events.replan.jsonl — use case 05, el plan cambia en vuelo.

El ritmo sale de occurred_at: recordedSource espera la diferencia entre eventos
consecutivos. Todo el run dura ~100 s. El momento del demo es el replan: la
línea recta de seis pasos se convierte en un diamante cuando el BL revela un
transbordo en Busan que el booking no tenía.
"""
import hashlib
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "frontend" / "lib" / "donald" / "events.replan.jsonl"
RUN_KEY = "nauta-replan-005"
T0 = datetime(2026, 8, 29, 15, 41, 12, tzinfo=timezone.utc)
PACE = 1.5  # stretches every advance so the whole run reads at ~100 s

events = []
clock = 0.0


def stamp(offset):
    return (T0 + timedelta(seconds=offset)).isoformat().replace("+00:00", "+00:00")


def emit(event_type, payload, node_key=None, agent="Nina", advance=0.0):
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


def sub(key, label, status="pending"):
    return {"key": key, "label": label, "status": status}


# ── the plan as first declared (revision 1): six steps, a straight line ─────
STEPS = [
    ("ingest_arrival_notice", "Read the arrival notice", "Nina", 8),
    ("identify_booking", "Match to booking", "Nina", 12),
    ("extract_bl", "Extract the bill of lading", "Theo", 22),
    ("reconcile_routing", "Reconcile routing against the booking", "Theo", 26),
    ("monitor_eta", "Track the ETA", "Nina", 14),
    ("act_confirm_arrival", "Confirm the delivery date to the client", "Nina", 12),
]

EDGES = [
    ("ingest_arrival_notice", "identify_booking"),
    ("identify_booking", "extract_bl"),
    ("extract_bl", "reconcile_routing"),
    ("reconcile_routing", "monitor_eta"),
    ("monitor_eta", "act_confirm_arrival"),
]

emit("run_started", {
    "run_key": RUN_KEY,
    "name": "Check the arrival of shipment OP-4471 and confirm the delivery date to the client.",
    "scenario": "nauta-replan",
    "client_name": "Muebles del Sur",
    "provider": "Nauta",
    "agents": [
        {"label": "Nina", "role": "Shipment Watch"},
        {"label": "Theo", "role": "Freight Anomaly"},
    ],
}, agent=None)

emit("plan_declared", {
    "graph_revision": 1,
    "proposed": True,
    "revisable": True,
    "basis": "provider's established workflow for arrival confirmation",
    "plan": {
        "graph_revision": 1,
        "basis": "provider's established workflow for arrival confirmation",
        "summary": "Read the arrival notice, verify the documents against the booking, and confirm the delivery date to the client.",
        "steps": [
            {"node_key": k, "agent_label": ag, "label": lbl, "estimated_seconds": s}
            for k, lbl, ag, s in STEPS
        ],
        "edges": [
            {"edge_key": f"{a}-to-{b}", "source_node_key": a, "target_node_key": b}
            for a, b in EDGES
        ],
    },
    "total_estimated_seconds": sum(s for _, _, _, s in STEPS),
}, agent=None)

for i, (key, label, agent, secs) in enumerate(STEPS, start=1):
    emit("node_added", {
        "label": label, "estimated_seconds": secs, "planned": True, "plan_order": i,
    }, node_key=key, agent=agent, advance=0.08)

for a, b in EDGES:
    emit("edge_added", {
        "edge_key": f"{a}-to-{b}", "source_node_key": a, "target_node_key": b, "planned": True,
    }, agent=None, advance=0.05)


def start(key, subtasks=None, advance=1.4, agent="Nina", input_summary=None):
    payload = {"status": "in_progress", "started_at": stamp(clock + advance * PACE)}
    if input_summary:
        payload["input_summary"] = input_summary
    if subtasks is not None:
        payload["subtasks"] = subtasks
    emit("node_status_changed", payload, node_key=key, agent=agent, advance=advance)


def progress(key, message, percent, subtasks=None, advance=2.6, agent="Nina"):
    payload = {"message": message, "progress_percent": percent}
    if subtasks is not None:
        payload["subtasks"] = subtasks
    emit("node_updated", payload, node_key=key, agent=agent, advance=advance)


def done(key, headline, finding=None, manual_minutes=None, metrics=None,
         subtasks=None, advance=2.2, agent="Nina"):
    payload = {"status": "succeeded", "headline": headline}
    if finding:
        payload["finding"] = finding
    if manual_minutes is not None:
        payload["manual_minutes"] = manual_minutes
    if metrics:
        payload["metrics"] = metrics
    if subtasks is not None:
        payload["subtasks"] = subtasks
    emit("node_status_changed", payload, node_key=key, agent=agent, advance=advance)


# ── 1 · INGEST ──────────────────────────────────────────────────────────────
start("ingest_arrival_notice", advance=1.6)
progress("ingest_arrival_notice", "Reading the carrier arrival notice for OP-4471", 40,
         advance=2.4)
emit("artifact_added", {
    "artifact_type": "text",
    "message_id": "NOTICE-OP-4471",
    "name": "Arrival notice — OP-4471",
    "text_content": (
        "source: Carrier Notifications inbox\n"
        "received: 15:41:12\n"
        "shipment: OP-4471\n"
        "vessel_on_notice: MSC IRINA\n"
        "port_of_discharge: Manzanillo, MX\n"
        "consignee: Muebles del Sur\n"
        "attached: bill of lading MSCUXM2213"
    ),
}, node_key="ingest_arrival_notice", advance=2.0)
done("ingest_arrival_notice",
     "Arrival notice received for OP-4471",
     "Carrier notice names MSC IRINA into Manzanillo with BL MSCUXM2213 attached.",
     manual_minutes=6, advance=2.0)

# ── 2 · IDENTIFY ────────────────────────────────────────────────────────────
start("identify_booking", advance=1.2)
progress("identify_booking", "Searching open bookings for shipment OP-4471", 50,
         advance=2.6)
done("identify_booking",
     "Matched to booking BKG-99210",
     "OP-4471 is booking BKG-99210: Shanghai to Manzanillo for Muebles del Sur, booked direct.",
     manual_minutes=8, advance=2.4)

# ── 3 · EXTRACT · three subtasks ────────────────────────────────────────────
EX = [
    sub("header", "Read the BL header"),
    sub("routing", "Extract the routing legs"),
    sub("cargo", "Extract cargo and consignee"),
]
def ex(states):
    return [dict(s, status=st) for s, st in zip(EX, states)]

start("extract_bl", ex(["running", "pending", "pending"]),
      advance=1.2, agent="Theo", input_summary="MSCUXM2213.pdf")
progress("extract_bl", "BL MSCUXM2213 — header parsed, shipper and consignee match", 30,
         ex(["done", "running", "pending"]), advance=3.0, agent="Theo")
progress("extract_bl", "Routing block lists two legs, not one", 65,
         ex(["done", "done", "running"]), advance=3.0, agent="Theo")
done("extract_bl",
     "BL MSCUXM2213 extracted",
     "Shipper, consignee and cargo match the booking. The routing block carries two legs and names a transshipment port.",
     manual_minutes=14, subtasks=ex(["done"] * 3), advance=2.8, agent="Theo")

# ── 4 · RECONCILE · the step that finds the problem ─────────────────────────
RC = [
    sub("pull_booking", "Pull the booked routing for BKG-99210"),
    sub("compare_legs", "Compare BL legs against the booking"),
]
def rc(states):
    return [dict(s, status=st) for s, st in zip(RC, states)]

start("reconcile_routing", rc(["running", "pending"]), advance=1.2, agent="Theo")
progress("reconcile_routing", "Comparing BL routing against booking BKG-99210", 40,
         rc(["done", "running"]), advance=3.0, agent="Theo")
done("reconcile_routing",
     "MISMATCH: the BL shows a transshipment at Busan",
     "BL MSCUXM2213 routes the cargo onto MSC IRINA via Busan. The booking was direct Shanghai–Manzanillo.",
     manual_minutes=18, subtasks=rc(["done"] * 2), advance=3.2, agent="Theo")

# ── THE REPLAN · revise the graph the moment the plan is known to be wrong ──
emit("run_updated", {
    "graph_revision": 2,
    "reason": "The unplanned transshipment invalidates the original ETA and needs its own documents",
    "triggered_by": "reconcile_routing",
    "evidence": ["MSCUXM2213"],
}, agent=None, advance=1.6)

emit("node_status_changed", {
    "status": "skipped",
    "finding": "The booked ETA describes a sailing that did not happen.",
}, node_key="monitor_eta", advance=0.8)

emit("node_added", {
    "label": "Extract the second-leg BL", "estimated_seconds": 24, "graph_revision": 2,
}, node_key="extract_second_leg_bl", agent="Theo", advance=0.6)

emit("node_added", {
    "label": "Recompute the two-leg ETA", "estimated_seconds": 20, "graph_revision": 2,
}, node_key="recompute_eta", advance=0.4)

NEW_EDGES = [
    ("reconcile_routing", "extract_second_leg_bl"),
    ("extract_second_leg_bl", "recompute_eta"),
    ("extract_second_leg_bl", "act_confirm_arrival"),
    ("recompute_eta", "act_confirm_arrival"),
]
for a, b in NEW_EDGES:
    emit("edge_added", {
        "edge_key": f"{a}-to-{b}", "source_node_key": a, "target_node_key": b,
        "graph_revision": 2,
    }, agent=None, advance=0.3)

# ── 5 · EXTRACT SECOND LEG · discovered work ────────────────────────────────
start("extract_second_leg_bl", advance=1.4, agent="Theo")
progress("extract_second_leg_bl", "Requesting the Busan onward BL from the carrier portal", 45,
         advance=3.2, agent="Theo")
done("extract_second_leg_bl",
     "Second BL MSCUBS4419: Busan → Manzanillo on MSC IRINA",
     "The onward leg is documented under its own BL. Cargo and consignee match MSCUXM2213.",
     manual_minutes=22, advance=3.2, agent="Theo")

# ── 6 · RECOMPUTE ETA · discovered work ─────────────────────────────────────
start("recompute_eta", advance=1.2)
progress("recompute_eta", "Chaining both legs: Shanghai–Busan dwell plus Busan–Manzanillo sailing", 50,
         advance=3.2)
done("recompute_eta",
     "Revised ETA 12-SEP, five days later than booked",
     "MSC IRINA departs Busan 30-AUG. The booked direct ETA of 07-SEP no longer applies.",
     manual_minutes=16,
     metrics={"revised_eta": "2026-09-12", "delay_days": 5},
     advance=3.2)

# ── 7 · CONFIRM · joins both new branches and closes the run ────────────────
AC = [
    sub("draft", "Draft the client notification"),
    sub("attach", "Attach both bills of lading"),
    sub("send", "Send and log the confirmation"),
]
def ac(states):
    return [dict(s, status=st) for s, st in zip(AC, states)]

start("act_confirm_arrival", ac(["running", "pending", "pending"]), advance=1.4)
progress("act_confirm_arrival", "Drafting the revised delivery confirmation", 30,
         ac(["done", "running", "pending"]), advance=2.8)

emit("artifact_added", {
    "artifact_type": "text",
    "message_id": "MSG-OP-4471-CONFIRM",
    "name": "Delivery confirmation — OP-4471",
    "text_content": (
        "To: imports@mueblesdelsur.mx\n"
        "From: ops-automation@nauta.io\n"
        "Date: 29 Aug 2026 15:43 UTC\n"
        "Subject: OP-4471 - revised arrival, ETA 12-SEP via Busan\n\n"
        "Dear Muebles del Sur team,\n\n"
        "Your shipment OP-4471 (booking BKG-99210) was transshipped at Busan onto\n"
        "MSC IRINA. The revised ETA into Manzanillo is 12-SEP, five days later than\n"
        "originally booked.\n\n"
        "Both bills of lading are attached: MSCUXM2213 (Shanghai-Busan) and\n"
        "MSCUBS4419 (Busan-Manzanillo).\n\n"
        "Nauta Operations"
    ),
}, node_key="act_confirm_arrival", advance=2.6)

progress("act_confirm_arrival", "Both BLs attached - sending", 70,
         ac(["done", "done", "running"]), advance=2.6)

done("act_confirm_arrival",
     "Client notified: ETA 12-SEP via Busan, both BLs attached",
     "Muebles del Sur has the revised delivery date and the complete two-leg document set.",
     manual_minutes=12, subtasks=ac(["done"] * 3), advance=3.0)

emit("run_finished", {
    "summary": {
        "headline": "Arrival confirmed on a revised routing",
        "detail": (
            "OP-4471 arrives 12-SEP via Busan instead of the booked direct sailing. "
            "The plan was revised once mid-run when the BL revealed the unplanned "
            "transshipment: the booked ETA step was dropped, and the second-leg BL "
            "and two-leg ETA were extracted before the client was notified."
        ),
    },
}, agent=None, advance=2.0)

with open(OUT, "w", encoding="utf-8", newline="\n") as fh:
    for event in events:
        fh.write(json.dumps(event, ensure_ascii=False) + "\n")

print(f"{len(events)} events, {clock:.1f}s of wall clock -> {OUT}")
