"""Genera events.land-pickup.jsonl — use case 08, con subtareas por tarjeta.

El ritmo sale de occurred_at: recordedSource espera la diferencia entre eventos
consecutivos. Todo el run dura ~105 s, suficiente para leer cada subtarea sin
que la demo se haga eterna.
"""
import hashlib
import json
from datetime import datetime, timedelta, timezone

OUT = "events.land-pickup.jsonl"
RUN_KEY = "nauta-land-pickup-008"
T0 = datetime(2026, 8, 29, 14, 2, 3, tzinfo=timezone.utc)

events = []
clock = 0.0


def stamp(offset):
    return (T0 + timedelta(seconds=offset)).isoformat().replace("+00:00", "+00:00")


def emit(event_type, payload, node_key=None, agent="Ari", advance=0.0):
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


# ── the plan ────────────────────────────────────────────────────────────────
STEPS = [
    ("ingest_capacity_response", "Read the carrier capacity response", 8),
    ("identify_operation", "Identify container and operation", 12),
    ("extract_response_terms", "Extract reason code and cutoffs", 20),
    ("reconcile_free_time", "Compare against free-time terms", 24),
    ("monitor_free_time_clock", "Track the free-time clock", 14),
    ("predict_overrun", "Forecast the overrun", 26),
    ("detect_capacity_conflict", "Confirm the exception", 12),
    ("explain_root_cause", "Root cause the conflict", 34),
    ("calculate_exposure", "Quantify the exposure", 20),
    ("plan_responses", "Generate and rank responses", 24),
    ("decide_response", "Decide the response", 10),
    ("act_book_alternate", "Book the alternate carrier", 22),
]

EDGES = [
    ("ingest_capacity_response", "identify_operation"),
    ("identify_operation", "extract_response_terms"),
    ("extract_response_terms", "reconcile_free_time"),
    ("reconcile_free_time", "monitor_free_time_clock"),
    ("reconcile_free_time", "predict_overrun"),
    ("monitor_free_time_clock", "detect_capacity_conflict"),
    ("predict_overrun", "detect_capacity_conflict"),
    ("detect_capacity_conflict", "explain_root_cause"),
    ("explain_root_cause", "calculate_exposure"),
    ("calculate_exposure", "plan_responses"),
    ("plan_responses", "decide_response"),
    ("decide_response", "act_book_alternate"),
]

emit("run_started", {
    "run_key": RUN_KEY,
    "name": "Resolve the land pickup conflict on BERU-40022",
    "scenario": "nauta-land-pickup",
    "provider": "Nauta",
    "agents": [{"label": "Ari", "role": "Land operations"}],
}, agent=None)

emit("plan_declared", {
    "graph_revision": 1,
    "proposed": True,
    "revisable": True,
    "basis": "provider's established workflow for land pickup exceptions",
    "plan": {
        "graph_revision": 1,
        "basis": "provider's established workflow for land pickup exceptions",
        "summary": "Establish whether the carrier's slot clears free time, and act before the rebooking cutoff.",
        "steps": [
            {"node_key": k, "agent_label": "Ari", "label": lbl, "estimated_seconds": s}
            for k, lbl, s in STEPS
        ],
        "edges": [
            {"edge_key": f"{a}-to-{b}", "source_node_key": a, "target_node_key": b}
            for a, b in EDGES
        ],
    },
    "total_estimated_seconds": sum(s for _, _, s in STEPS),
}, agent=None)

for i, (key, label, secs) in enumerate(STEPS, start=1):
    emit("node_added", {
        "label": label, "estimated_seconds": secs, "planned": True, "plan_order": i,
    }, node_key=key, advance=0.08)

for a, b in EDGES:
    emit("edge_added", {
        "edge_key": f"{a}-to-{b}", "source_node_key": a, "target_node_key": b, "planned": True,
    }, agent=None, advance=0.05)


def start(key, subtasks=None, advance=1.4, input_summary=None):
    payload = {"status": "in_progress", "started_at": stamp(clock + advance)}
    if input_summary:
        payload["input_summary"] = input_summary
    if subtasks is not None:
        payload["subtasks"] = subtasks
    emit("node_status_changed", payload, node_key=key, advance=advance)


def progress(key, message, percent, subtasks=None, advance=2.6):
    payload = {"message": message, "progress_percent": percent}
    if subtasks is not None:
        payload["subtasks"] = subtasks
    emit("node_updated", payload, node_key=key, advance=advance)


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
    emit("node_status_changed", payload, node_key=key, advance=advance)


# ── 1 · INGEST ──────────────────────────────────────────────────────────────
start("ingest_capacity_response", advance=1.6)
emit("artifact_added", {
    "artifact_type": "text",
    "message_id": "API-CAP-4812",
    "name": "Capacity response — BERU-40022",
    "text_content": (
        "source: Land Carrier Network API\n"
        "received: 14:02:03\n"
        "capacity: NEGATIVE\n"
        "reason_code: CAP-FULL\n"
        "offered_window: Thu 09:00\n"
        "rebooking_cutoff: Wed 17:00\n"
        "reschedule_fee_before_cutoff: 0.00 USD"
    ),
}, node_key="ingest_capacity_response", advance=1.8)
done("ingest_capacity_response",
     "Carrier has no capacity Thursday",
     "Land Carrier Network answered the pickup request for BERU-40022 with capacity negative.",
     manual_minutes=6, advance=1.8)

# ── 2 · IDENTIFY ────────────────────────────────────────────────────────────
start("identify_operation", advance=1.0)
done("identify_operation",
     "BERU-40022 · PO-88213",
     "Land Pickup Handoff run #4,812. Berrios, San Juan.",
     manual_minutes=8, advance=2.4)

# ── 3 · EXTRACT · four subtasks ─────────────────────────────────────────────
EX = [
    sub("reason", "Read the reason code"),
    sub("window", "Read the offered window"),
    sub("cutoff", "Find the rebooking cutoff"),
    sub("fee", "Check the reschedule fee"),
]
def ex(states):
    return [dict(s, status=st) for s, st in zip(EX, states)]

start("extract_response_terms", ex(["running", "pending", "pending", "pending"]),
      advance=1.2, input_summary="capacity_response.json")
progress("extract_response_terms", "Reason code CAP-FULL", 25,
         ex(["done", "running", "pending", "pending"]), advance=3.0)
progress("extract_response_terms", "Offered window Thu 09:00", 50,
         ex(["done", "done", "running", "pending"]), advance=2.8)
progress("extract_response_terms", "Rebooking cutoff Wed 17:00", 75,
         ex(["done", "done", "done", "running"]), advance=2.8)
done("extract_response_terms",
     "Rebooking is free before Wed 17:00",
     "Reason CAP-FULL. Offered window Thu 09:00. Rebooking before the Wed 17:00 cutoff costs nothing.",
     manual_minutes=14, subtasks=ex(["done"] * 4), advance=2.8)

# ── 4 · RECONCILE · three subtasks ──────────────────────────────────────────
RC = [
    sub("pull_terms", "Pull the free-time terms for BERU-40022"),
    sub("compute", "Compute the deadline"),
    sub("compare", "Compare against the offered slot"),
]
def rc(states):
    return [dict(s, status=st) for s, st in zip(RC, states)]

start("reconcile_free_time", rc(["running", "pending", "pending"]), advance=1.2)
progress("reconcile_free_time", "Terms retrieved for this lane", 35,
         rc(["done", "running", "pending"]), advance=3.0)
progress("reconcile_free_time", "Free time expires Wed 23:59", 70,
         rc(["done", "done", "running"]), advance=3.0)
done("reconcile_free_time",
     "The carrier's slot is 9h 01m past the deadline",
     "Free time expires Wed 23:59. The carrier's earliest slot is Thu 09:00.",
     manual_minutes=18, subtasks=rc(["done"] * 3), advance=3.0)

# ── 5 & 6 · MONITOR and PREDICT, in parallel ────────────────────────────────
start("monitor_free_time_clock", advance=1.2)
start("predict_overrun", advance=0.5)
progress("predict_overrun", "Modelling the rebooking window", 40, advance=2.6)
done("monitor_free_time_clock",
     "1 day 9 hours left",
     "Now the most urgent of 14 active operations.",
     manual_minutes=10, advance=1.6)
progress("predict_overrun", "Scoring the Thursday slot", 75, advance=2.4)
done("predict_overrun",
     "Roughly 2 days late if nothing changes",
     "Unresolved by the Wed 17:00 cutoff means clearing free time about 2 days late.",
     manual_minutes=22, advance=2.6)

# ── 7 · DETECT ──────────────────────────────────────────────────────────────
start("detect_capacity_conflict", advance=1.2)
done("detect_capacity_conflict",
     "Land pickup capacity conflict",
     "Outside the three documented automations - this needs reasoning, not a rule.",
     manual_minutes=12, advance=2.6)

# ── 8 · EXPLAIN · the star: a fourth subtask appears mid-step ───────────────
start("explain_root_cause", [
    sub("capacity_log", "Check the carrier's capacity log", "running"),
    sub("alternates", "Check alternate carriers in the network"),
    sub("lane_history", "Check the last 90 days on this lane"),
], advance=1.4)

progress("explain_root_cause",
         "Supplier fully booked Thursday - a local holiday cut the available slots", 25, [
             sub("capacity_log", "Check the carrier's capacity log", "done"),
             sub("holiday", "Confirm the San Juan holiday calendar", "running"),
             sub("alternates", "Check alternate carriers in the network"),
             sub("lane_history", "Check the last 90 days on this lane"),
         ], advance=3.4)

progress("explain_root_cause", "Holiday confirmed on the San Juan calendar", 50, [
    sub("capacity_log", "Check the carrier's capacity log", "done"),
    sub("holiday", "Confirm the San Juan holiday calendar", "done"),
    sub("alternates", "Check alternate carriers in the network", "running"),
    sub("lane_history", "Check the last 90 days on this lane"),
], advance=3.2)

progress("explain_root_cause", "Two alternates checked - one confirms Wednesday morning", 75, [
    sub("capacity_log", "Check the carrier's capacity log", "done"),
    sub("holiday", "Confirm the San Juan holiday calendar", "done"),
    sub("alternates", "Check alternate carriers in the network", "done"),
    sub("lane_history", "Check the last 90 days on this lane", "running"),
], advance=3.2)

progress("explain_root_cause", "No comparable record on this lane in 90 days", 90, [
    sub("capacity_log", "Check the carrier's capacity log", "done"),
    sub("holiday", "Confirm the San Juan holiday calendar", "done"),
    sub("alternates", "Check alternate carriers in the network", "done"),
    # An empty source is a finding, not a failure: the subtask ends failed and
    # the step keeps going.
    sub("lane_history", "Check the last 90 days on this lane", "failed"),
], advance=3.0)

done("explain_root_cause",
     "A local holiday cut Thursday's slots",
     "One alternate carrier has Wednesday morning availability. First occurrence on this lane.",
     manual_minutes=35,
     subtasks=[
         sub("capacity_log", "Check the carrier's capacity log", "done"),
         sub("holiday", "Confirm the San Juan holiday calendar", "done"),
         sub("alternates", "Check alternate carriers in the network", "done"),
         sub("lane_history", "Check the last 90 days on this lane", "failed"),
     ], advance=3.0)

# ── 9 · IMPACT ──────────────────────────────────────────────────────────────
start("calculate_exposure", advance=1.2)
done("calculate_exposure",
     "$276-414 exposed, $0 to avoid it",
     "Against a North American average of $138-150 per day. No rebooking fee before Wed 17:00.",
     manual_minutes=16,
     metrics={"exposure_usd": 414, "rebooking_fee_usd": 0},
     advance=2.8)

# ── 10 · PLAN · one subtask per priced option ───────────────────────────────
PL = [
    sub("price_alternate", "Price the alternate carrier"),
    sub("price_extension", "Price the port extension"),
    sub("price_absorb", "Price accepting the miss"),
]
def pl(states):
    return [dict(s, status=st) for s, st in zip(PL, states)]

start("plan_responses", pl(["running", "pending", "pending"]), advance=1.2)
progress("plan_responses", "Alternate carrier: Wednesday AM, $0", 33,
         pl(["done", "running", "pending"]), advance=3.0)
progress("plan_responses", "Port extension: $90 admin, not guaranteed", 66,
         pl(["done", "done", "running"]), advance=2.8)
done("plan_responses",
     "Three options, one at no cost",
     "Book the alternate carrier at $0, request a 48h extension at $90, or accept a $276-414 miss.",
     manual_minutes=26, subtasks=pl(["done"] * 3), advance=2.8)

# ── 11 · DECIDE · the human gate ────────────────────────────────────────────
start("decide_response", advance=1.2)
emit("intervention_requested", {
    "type": "steer",
    "prompt": "Rebooking is free until Wed 17:00, and only one option clears free time at no cost. How should Ari proceed?",
    "options": [
        {"id": "book-alternate", "label": "Book the alternate carrier - Wed AM, $0",
         "rationale": "Clears free time with about 12 hours to spare and incurs no fee.",
         "rank": 1, "branch": "book-alternate", "maximum_cost_usd": 0},
        {"id": "request-extension", "label": "Request a 48h port extension - $90 admin fee",
         "rationale": "Buys room for the Thursday slot, but the terminal may refuse.",
         "rank": 2, "branch": "request-extension", "maximum_cost_usd": 90},
        {"id": "accept-miss", "label": "Accept the miss and notify finance - $276-414",
         "rationale": "No action taken; the charge is documented before it appears.",
         "rank": 3, "branch": "accept-miss", "maximum_cost_usd": 414},
    ],
    "default_option_id": "book-alternate",
}, node_key="decide_response", advance=2.0)

emit("agent_message", {
    "message": "Ari is waiting on a decision - the free rebooking window closes Wed 17:00.",
}, node_key="decide_response", advance=4.5)

emit("intervention_resolved", {
    "option_id": "book-alternate",
    "branch_id": "book-alternate",
    "used_default": False,
}, node_key="decide_response", advance=4.0)

done("decide_response",
     "Operator chose the alternate carrier",
     "Approved at no cost, inside the free rebooking window.",
     manual_minutes=9, advance=1.8)

# ── 12 · ACT · three subtasks after the gate ────────────────────────────────
AC = [
    sub("draft", "Draft the pickup request"),
    sub("send", "Send it to the alternate carrier"),
    sub("record", "Record the confirmation"),
]
def ac(states):
    return [dict(s, status=st) for s, st in zip(AC, states)]

start("act_book_alternate", ac(["running", "pending", "pending"]), advance=1.2)
progress("act_book_alternate", "Request drafted", 30,
         ac(["done", "running", "pending"]), advance=2.8)

emit("artifact_added", {
    "artifact_type": "text",
    "message_id": "MSG-ALT-9931",
    "name": "Pickup request — BERU-40022",
    "text_content": (
        "To: dispatch@altcarrier.pr\n"
        "From: ops-automation@berrios-nauta.pr\n"
        "Date: 29 Aug 2026 14:06 UTC\n"
        "Subject: Pickup request - BERU-40022, Wed AM window\n\n"
        "Requesting pickup for container BERU-40022 (PO-88213), Wednesday AM window.\n"
        "Original carrier at capacity for Thursday. Please confirm earliest available slot."
    ),
}, node_key="act_book_alternate", advance=2.4)

progress("act_book_alternate", "Sent - awaiting confirmation", 65,
         ac(["done", "done", "running"]), advance=2.6)

done("act_book_alternate",
     "Pickup confirmed for Wed 08:00",
     "Confirmation #ALT-9931. Clears free time with about 12 hours to spare.",
     manual_minutes=20, subtasks=ac(["done"] * 3), advance=3.0)

emit("run_finished", {
    "summary": {
        "headline": "BERU-40022 rebooked at no cost",
        "detail": (
            "Pickup moved to Wed 08:00 with an alternate carrier, clearing free time with "
            "about 12 hours to spare. $276-414 in exposure avoided and no rebooking fee incurred."
        ),
    },
}, agent=None, advance=2.0)

with open(OUT, "w", encoding="utf-8", newline="\n") as fh:
    for event in events:
        fh.write(json.dumps(event, ensure_ascii=False) + "\n")

print(f"{len(events)} events, {clock:.1f}s of wall clock -> {OUT}")
