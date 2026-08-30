"""Genera events.missing-invoice.jsonl — use case 02, la factura que nunca llegó.

El ritmo sale de occurred_at: recordedSource espera la diferencia entre eventos
consecutivos. Todo el run dura ~115 s: seis pasos de aduana en línea, el paso 3
descubre trabajo nuevo (la tarjeta que crece hacia abajo), el run se queda ámbar
esperando al proveedor, y un gate decide si esperar o presentar con valor
provisional.
"""
import hashlib
import json
from datetime import datetime, timedelta, timezone

OUT = "events.missing-invoice.jsonl"
RUN_KEY = "nauta-missing-invoice-002"
T0 = datetime(2026, 8, 29, 15, 41, 12, tzinfo=timezone.utc)

events = []
clock = 0.0


def stamp(offset):
    return (T0 + timedelta(seconds=offset)).isoformat().replace("+00:00", "+00:00")


AGENT_FOR = {
    "ingest_asn": "Nina",
    "identify_po": "Nina",
    "find_commercial_invoice": "Nina",
    "obtain_missing_invoice": "Nina",
    "establish_customs_value": "Nina",
    "calculate_duties": "Alec",
    "file_customs_entry": "Alec",
}


def emit(event_type, payload, node_key=None, advance=0.0):
    global clock
    clock += advance
    idem = hashlib.sha256(
        f"{event_type}:{node_key}:{len(events)}:{RUN_KEY}".encode()
    ).hexdigest()
    events.append({
        "sequence": len(events) + 1,
        "event_type": event_type,
        "occurred_at": stamp(clock),
        "agent_label": AGENT_FOR.get(node_key) if node_key else None,
        "node_key": node_key,
        "idempotency_key": idem,
        "payload": payload,
    })


def sub(key, label, status="pending"):
    return {"key": key, "label": label, "status": status}


# ── the plan ────────────────────────────────────────────────────────────────
STEPS = [
    ("ingest_asn", "Read the shipment notice", "Nina", 8),
    ("identify_po", "Find the purchase order", "Nina", 10),
    ("find_commercial_invoice", "Find the commercial invoice", "Nina", 22),
    ("establish_customs_value", "Establish the customs value", "Nina", 16),
    ("calculate_duties", "Calculate duties and fees", "Alec", 18),
    ("file_customs_entry", "File the customs entry", "Alec", 20),
]

EDGES = [
    ("ingest_asn", "identify_po"),
    ("identify_po", "find_commercial_invoice"),
    ("find_commercial_invoice", "establish_customs_value"),
    ("establish_customs_value", "calculate_duties"),
    ("calculate_duties", "file_customs_entry"),
]

emit("run_started", {
    "run_key": RUN_KEY,
    "name": ("The commercial invoice for PO-44190 never arrived. Find out what "
             "happened and get the customs entry filed before the deadline."),
    "scenario": "nauta-missing-invoice",
    "client_name": "Muebles del Sur",
    "provider": "Nauta",
    "agents": [
        {"label": "Nina", "role": "Shipment Watch"},
        {"label": "Alec", "role": "Contract Compliance"},
    ],
})

emit("plan_declared", {
    "graph_revision": 1,
    "proposed": True,
    "revisable": True,
    "basis": "provider's established workflow for customs entry filing",
    "plan": {
        "graph_revision": 1,
        "basis": "provider's established workflow for customs entry filing",
        "summary": ("Trace the missing commercial invoice for PO-44190, establish "
                    "the customs value, and file the entry before the deadline."),
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
})

for i, (key, label, _ag, secs) in enumerate(STEPS, start=1):
    emit("node_added", {
        "label": label, "estimated_seconds": secs, "planned": True, "plan_order": i,
    }, node_key=key, advance=0.08)

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
start("ingest_asn", advance=1.6)
progress("ingest_asn",
         "Reading the advance shipment notice from the ocean carrier.",
         40, advance=2.8)
done("ingest_asn",
     "Container on the water — ETA Long Beach, Sep 9",
     "The supplier shipped early. The container sailed from Ningbo and the "
     "customs entry must be filed before arrival.",
     manual_minutes=6, advance=2.4)

# ── 2 · IDENTIFY ────────────────────────────────────────────────────────────
start("identify_po", advance=1.2)
progress("identify_po",
         "Searching the supplier portal for the purchase order behind this shipment.",
         45, advance=3.0)
done("identify_po",
     "Found PO-44190 — 9 SKUs, FOB Ningbo",
     "Muebles del Sur order with Ningbo Casa Furniture Co. Nine furniture SKUs, "
     "FOB Ningbo terms. The packing list is on file.",
     manual_minutes=9, advance=2.8)

# ── 3 · EXTRACT · the invoice is not there ──────────────────────────────────
FI = [
    sub("search_portal", "Search the supplier portal"),
    sub("search_mailbox", "Search the shared mailbox"),
    sub("match_po", "Match the invoice against the PO"),
]
def fi(states):
    return [dict(s, status=st) for s, st in zip(FI, states)]

start("find_commercial_invoice", fi(["running", "pending", "pending"]),
      advance=1.4, input_summary="PO-44190 document set")
progress("find_commercial_invoice",
         "Searching the supplier portal for a commercial invoice on PO-44190.",
         20, fi(["running", "pending", "pending"]), advance=3.0)
progress("find_commercial_invoice",
         "Nothing in the portal. Searching the shared mailbox and its attachments.",
         45, fi(["done", "running", "pending"]), advance=3.4)
progress("find_commercial_invoice",
         "No invoice anywhere. The commercial invoice for PO-44190 was never received.",
         70, fi(["done", "done", "failed"]), advance=3.4)

emit("agent_message", {
    "message": ("The invoice cannot be matched because it never arrived. Nina is "
                "adding a recovery step: obtain the invoice from the supplier."),
}, node_key="find_commercial_invoice", advance=2.4)

# ── 3b · DISCOVERED · the card that grows downward ──────────────────────────
emit("node_added", {
    "label": "Obtain the invoice from the supplier",
    "estimated_seconds": 40,
}, node_key="obtain_missing_invoice", advance=1.0)

emit("edge_added", {
    "edge_key": "find_commercial_invoice-to-obtain_missing_invoice",
    "source_node_key": "find_commercial_invoice",
    "target_node_key": "obtain_missing_invoice",
}, advance=0.4)

OB = [
    sub("contact_supplier", "Contact the supplier"),
    sub("draft_email", "Draft the request email"),
    sub("send_await", "Send and await the reply"),
]
def ob(states):
    return [dict(s, status=st) for s, st in zip(OB, states)]

start("obtain_missing_invoice", ob(["running", "pending", "pending"]), advance=1.2)
progress("obtain_missing_invoice",
         "Documentation contact found at Ningbo Casa Furniture. Drafting the request.",
         25, ob(["done", "running", "pending"]), advance=3.0)

emit("artifact_added", {
    "artifact_type": "text",
    "message_id": "MSG-INV-REQ-4401",
    "name": "Invoice request — PO-44190",
    "text_content": (
        "To: docs@ningbocasafurniture.cn\n"
        "From: nina@ops.nauta.ai\n"
        "Date: 29 Aug 2026 15:42 UTC\n"
        "Subject: Commercial invoice needed — PO-44190, container on the water\n\n"
        "Hello,\n\n"
        "We are preparing the US customs entry for purchase order PO-44190\n"
        "(Muebles del Sur — 9 SKUs, FOB Ningbo). The container has already\n"
        "sailed, but the commercial invoice never reached our portal or the\n"
        "shared mailbox.\n\n"
        "Please reply with the commercial invoice for PO-44190 attached. The\n"
        "filing deadline is approaching, and without the invoice we cannot\n"
        "establish the customs value or calculate duties. Nothing has been\n"
        "submitted yet.\n\n"
        "Thank you,\n"
        "Nina — Shipment Watch, Nauta (for Muebles del Sur)"
    ),
}, node_key="obtain_missing_invoice", advance=3.2)

progress("obtain_missing_invoice",
         "Request sent to the supplier's documentation desk.",
         60, ob(["done", "done", "running"]), advance=2.6)

# ── the run goes amber ──────────────────────────────────────────────────────
emit("node_status_changed", {
    "status": "blocked_on_missing_data",
    "message": "Email sent. Awaiting the supplier's reply.",
    "subtasks": ob(["done", "done", "running"]),
}, node_key="obtain_missing_invoice", advance=2.2)

emit("agent_message", {
    "message": ("Still waiting on Ningbo Casa Furniture. The filing window is "
                "open, but every hour without the invoice narrows it."),
}, node_key="obtain_missing_invoice", advance=9.5)

# ── the gate, while waiting ─────────────────────────────────────────────────
emit("intervention_requested", {
    "type": "steer",
    "prompt": "The supplier has not replied. How should Nina proceed?",
    "options": [
        {"id": "keep-waiting",
         "label": "Keep waiting — free, filing slips ~1 day",
         "rationale": ("The supplier's desk is within business hours and the "
                       "deadline still holds if the invoice lands today. No fees, "
                       "no provisional values."),
         "rank": 1, "branch": "keep-waiting", "maximum_cost_usd": 0},
        {"id": "file-provisional",
         "label": "File with a provisional value — $180 amendment fee later",
         "rationale": ("Files immediately using the PO value as provisional, but "
                       "requires a post-summary amendment at $180 once the real "
                       "invoice arrives."),
         "rank": 2, "branch": "file-provisional", "maximum_cost_usd": 180},
    ],
    "default_option_id": "keep-waiting",
}, node_key="obtain_missing_invoice", advance=9.5)

emit("intervention_resolved", {
    "option_id": "keep-waiting",
    "branch_id": "keep-waiting",
    "used_default": False,
}, node_key="obtain_missing_invoice", advance=8.5)

# ── the reply arrives ───────────────────────────────────────────────────────
emit("artifact_added", {
    "artifact_type": "text",
    "message_id": "MSG-INV-RPL-4402",
    "name": "Supplier reply — Invoice CI-88907",
    "text_content": (
        "To: nina@ops.nauta.ai\n"
        "From: docs@ningbocasafurniture.cn\n"
        "Date: 29 Aug 2026 15:44 UTC\n"
        "Subject: RE: Commercial invoice needed — PO-44190, container on the water\n\n"
        "Hello Nina,\n\n"
        "Apologies for the delay — the invoice was issued with the shipment but\n"
        "was never uploaded to the portal.\n\n"
        "Invoice CI-88907 attached — USD 96,400, FOB Ningbo. Nine SKUs matching\n"
        "purchase order PO-44190, line totals as per the packing list.\n\n"
        "Please confirm receipt.\n\n"
        "Best regards,\n"
        "Documentation Desk, Ningbo Casa Furniture Co."
    ),
}, node_key="obtain_missing_invoice", advance=10.5)

emit("node_status_changed", {
    "status": "in_progress",
    "started_at": stamp(clock + 1.6),
    "message": "The supplier replied. Reading the attached invoice.",
    "subtasks": ob(["done", "done", "running"]),
}, node_key="obtain_missing_invoice", advance=1.6)

done("obtain_missing_invoice",
     "Invoice CI-88907 obtained — USD 96,400",
     "The supplier issued the invoice with the shipment but never uploaded it. "
     "CI-88907 covers all 9 SKUs of PO-44190, FOB Ningbo.",
     manual_minutes=25, subtasks=ob(["done"] * 3), advance=3.0)

# ── 3 · the original step can now finish ────────────────────────────────────
done("find_commercial_invoice",
     "Commercial invoice matched against the PO",
     "CI-88907 line totals match PO-44190 and the packing list. The document "
     "set for the entry is complete.",
     manual_minutes=12, subtasks=fi(["done", "done", "done"]), advance=2.6)

# ── 4 · RECONCILE ───────────────────────────────────────────────────────────
start("establish_customs_value", advance=1.4)
progress("establish_customs_value",
         "Verifying the invoice value against the purchase order line totals.",
         50, advance=3.0)
done("establish_customs_value",
     "Customs value established — USD 96,400",
     "Invoice CI-88907 matches PO-44190 across all 9 SKUs. FOB Ningbo terms "
     "confirmed; no additions or deductions to the transaction value.",
     manual_minutes=14, advance=2.8)

# ── 5 · IMPACT ──────────────────────────────────────────────────────────────
start("calculate_duties", advance=1.2)
progress("calculate_duties",
         "Applying the 16% duty rate across the 9 classified SKUs.",
         50, advance=3.2)
done("calculate_duties",
     "Duties USD 15,424 at 16%, MPF USD 341",
     "Duty of USD 15,424 on a customs value of USD 96,400 at 16%, plus a "
     "merchandise processing fee of USD 341. Total payable USD 15,765.",
     manual_minutes=18,
     metrics={"customs_value_usd": 96400, "duties_usd": 15424,
              "duty_rate_percent": 16, "mpf_usd": 341},
     advance=3.0)

# ── 6 · ACT ─────────────────────────────────────────────────────────────────
start("file_customs_entry", advance=1.2)
progress("file_customs_entry",
         "Assembling the entry package: CI-88907, packing list, PO-44190.",
         40, advance=3.0)
progress("file_customs_entry",
         "Submitting the entry to the broker gateway.",
         75, advance=2.8)
done("file_customs_entry",
     "Entry 315-9982177-4 filed",
     "Customs entry submitted before the deadline with the real invoice value. "
     "Release expected within 24 hours of arrival.",
     manual_minutes=20, advance=3.0)

emit("run_finished", {
    "summary": {
        "headline": "Entry filed on time",
        "detail": (
            "The missing invoice CI-88907 (USD 96,400, FOB Ningbo) was recovered "
            "from the supplier after one chase email. Customs value confirmed, "
            "duties of USD 15,424 at 16% plus a USD 341 processing fee "
            "calculated, and entry 315-9982177-4 filed before the deadline — "
            "no provisional values, no $180 amendment fee."
        ),
    },
}, advance=2.2)

with open(OUT, "w", encoding="utf-8", newline="\n") as fh:
    for event in events:
        fh.write(json.dumps(event, ensure_ascii=False) + "\n")

print(f"{len(events)} events, {clock:.1f}s of wall clock -> {OUT}")
