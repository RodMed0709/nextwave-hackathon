"""Nauta agent roster used to attribute simulated pipeline work."""

from __future__ import annotations


AGENT_ROSTER: dict[str, str] = {
    "Nina": "Shipment Watch",
    "Theo": "Freight Anomaly",
    "Marcus": "Inventory Watch",
    "Lauren": "Supplier Reliability",
    "Vera": "Price Drift",
    "Alec": "Contract Compliance",
}

STAGE_AGENTS: dict[str, str] = {
    "INGEST": "Nina",
    "EXTRACT": "Nina",
    "RECONCILE": "Theo",
    "DETECT": "Nina",
    "IMPACT": "Theo",
    "PLAN": "Marcus",
}
