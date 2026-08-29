"""Public Nauta seam; replace this module with an HTTP client when the real API is available."""

from __future__ import annotations

import json
import random
import time
from copy import deepcopy
from dataclasses import asdict, dataclass
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Iterator

from .agents import STAGE_AGENTS


STAGES = ("INGEST", "EXTRACT", "RECONCILE", "DETECT", "IMPACT", "PLAN")
SCENARIO_FILES = {
    "run-A": "run-A-tranquilo.json",
    "run-B": "run-B-problema.json",
}
FIXTURES_DIR = Path(__file__).with_name("fixtures")


@dataclass(frozen=True)
class PipelineEvent:
    stage: str
    seq: int
    ts: datetime
    agent: str
    title: str
    detail: str
    data: dict[str, Any]
    evidence: list[str]

    def to_dict(self) -> dict[str, Any]:
        """Return a detached, JSON-serializable event representation."""
        event = asdict(self)
        event["ts"] = self.ts.isoformat()
        return event


def _load_fixture(scenario: str) -> dict[str, Any]:
    try:
        filename = SCENARIO_FILES[scenario]
    except KeyError as error:
        choices = ", ".join(SCENARIO_FILES)
        raise ValueError(f"Unknown scenario {scenario!r}; expected one of: {choices}") from error

    with (FIXTURES_DIR / filename).open(encoding="utf-8") as fixture_file:
        return json.load(fixture_file)


def _main_message(fixture: dict[str, Any]) -> dict[str, Any]:
    return fixture["operation"]["recent_messages"][0]


def _all_evidence(fixture: dict[str, Any]) -> list[str]:
    evidence: list[str] = []
    for alert in fixture["alerts"]:
        for message_id in alert["evidence"]:
            if message_id not in evidence:
                evidence.append(message_id)
    return evidence


def _impact_data(fixture: dict[str, Any]) -> dict[str, Any]:
    operation = fixture["operation"]
    alerts = fixture["alerts"]
    eta_impact = next(
        alert["impact"] for alert in alerts if alert["type"] == "eta_slip"
    )

    return {
        "days_delta": eta_impact["days_delta"],
        "containers_affected": eta_impact.get(
            "containers_affected", len(operation["containers"])
        ),
        "billable_days": eta_impact.get("billable_days", 0),
        "estimated_cost_usd": eta_impact["estimated_cost_usd"],
        "reversible": all(alert["impact"]["reversible"] for alert in alerts),
        "bill_of_lading_blocks_release": any(
            alert["impact"].get("blocks_release", False) for alert in alerts
        ),
        "client_commitment_missed": any(
            alert["type"] == "client_commitment_at_risk" for alert in alerts
        ),
    }


def _plan_options(
    fixture: dict[str, Any], impact: dict[str, Any]
) -> list[dict[str, Any]]:
    voyage = fixture["operation"]["voyage"]
    eta = voyage["eta"]
    cost = impact["estimated_cost_usd"]

    if impact["reversible"] and cost == 0:
        return [
            {
                "id": "keep-monitoring",
                "label": "Mantener el itinerario actualizado",
                "cost_usd": 0,
                "eta": eta,
                "rationale": (
                    f"La desviación es de {impact['days_delta']} día y no genera costo."
                ),
                "rank": 1,
            }
        ]

    transshipment = voyage["transshipments"][0]
    return [
        {
            "id": "secure-new-bl",
            "label": "Exigir el nuevo Bill of Lading",
            "cost_usd": cost,
            "eta": eta,
            "rationale": (
                "Desbloquea la liberación documental tras el cambio a "
                f"{transshipment['new_vessel']}; conserva la exposición estimada."
            ),
            "rank": 1,
        },
        {
            "id": "negotiate-demurrage",
            "label": "Negociar la exención de demoras con MSC",
            "cost_usd": 0,
            "eta": eta,
            "rationale": (
                "El transbordo fue causado por sobrecupo del carrier; una exención "
                f"evitaría los USD {cost:,} estimados."
            ),
            "rank": 2,
        },
        {
            "id": "revise-client-commitment",
            "label": "Reprogramar el compromiso con el cliente",
            "cost_usd": cost,
            "eta": eta,
            "rationale": (
                f"La ETA {eta} rebasa la fecha comprometida y requiere coordinación inmediata."
            ),
            "rank": 3,
        },
    ]


def _event_specs(fixture: dict[str, Any]) -> list[dict[str, Any]]:
    operation = fixture["operation"]
    voyage = operation["voyage"]
    alerts = fixture["alerts"]
    message = _main_message(fixture)
    transshipment = voyage["transshipments"][0] if voyage["transshipments"] else None
    impact = _impact_data(fixture)
    all_evidence = _all_evidence(fixture)
    is_problem = not impact["reversible"]

    ingest = {
        key: message[key] for key in ("from", "subject", "received_at", "excerpt")
    }
    extract = {
        "carrier": voyage["carrier"],
        "vessel": voyage["vessel"],
        "eta": voyage["eta"],
        "eta_previous": voyage["eta_previous"],
        "transshipment": deepcopy(transshipment),
    }
    booking_on_file = {
        "carrier": voyage["carrier"],
        "vessel": voyage["vessel"],
        "eta": voyage["eta_previous"],
        "transshipment": False,
    }
    received_update = {
        "carrier": voyage["carrier"],
        "vessel": transshipment["new_vessel"] if transshipment else voyage["vessel"],
        "eta": voyage["eta"],
        "transshipment": transshipment is not None,
    }
    reconcile = {
        "booking_on_file": booking_on_file,
        "received_update": received_update,
        "agree": booking_on_file == received_update,
    }
    detect = {
        "alerts": [
            {
                "id": alert["alert_id"],
                "type": alert["type"],
                "severity": alert["severity"],
                "detail": alert["detail"],
            }
            for alert in alerts
        ]
    }
    plan = {"options": _plan_options(fixture, impact)}

    if is_problem:
        copy = [
            ("Correo urgente recibido", "Nina ingirió la actualización urgente del carrier."),
            (
                "Cambio de viaje estructurado",
                "Nina extrajo el transbordo no planeado, el nuevo buque y la ETA revisada.",
            ),
            (
                "La actualización no coincide con el booking",
                "Theo comparó el booking con el aviso: cambiaron el buque, la ruta y la ETA.",
            ),
            (
                "Tres anomalías de severidad alta",
                "Nina detectó riesgo de demora, un Bill of Lading faltante y un compromiso incumplido.",
            ),
            (
                "Impacto operativo y financiero confirmado",
                f"Theo calculó {impact['days_delta']} días de atraso y USD {impact['estimated_cost_usd']:,} de demoras. Sin el nuevo Bill of Lading no se libera la carga.",
            ),
            (
                "Opciones de mitigación priorizadas",
                "Marcus priorizó restaurar el documento, disputar las demoras y coordinar la nueva fecha con el cliente.",
            ),
        ]
    else:
        copy = [
            ("Actualización de itinerario recibida", "Nina ingirió el aviso del carrier."),
            ("Nueva ETA extraída", "Nina estructuró un ajuste de un día sin cambio de ruta."),
            ("Diferencia menor conciliada", "Theo comparó el aviso con el booking vigente."),
            ("Alerta de severidad baja", "Nina detectó una desviación menor y reversible."),
            ("Sin impacto financiero", "Theo confirmó que no hay días facturables ni costo estimado."),
            ("Seguimiento automático preparado", "Marcus propone mantener el itinerario actualizado."),
        ]

    payloads = [ingest, extract, reconcile, detect, impact, plan]
    evidence = [
        [message["message_id"]],
        [message["message_id"]],
        [message["message_id"]],
        all_evidence,
        all_evidence,
        all_evidence,
    ]
    return [
        {
            "stage": stage,
            "agent": STAGE_AGENTS[stage],
            "title": title,
            "detail": detail,
            "data": data,
            "evidence": event_evidence,
        }
        for stage, (title, detail), data, event_evidence in zip(
            STAGES, copy, payloads, evidence
        )
    ]


def stream(
    scenario: str,
    speed: float = 1.0,
    seed: int | None = None,
) -> Iterator[PipelineEvent]:
    """Yield one finite, realistically paced six-stage Nauta pipeline run."""
    if speed < 0:
        raise ValueError("speed must be non-negative")

    fixture = _load_fixture(scenario)
    event_specs = _event_specs(fixture)
    rng = random.Random(seed)
    gaps = [rng.uniform(0.8, 3.5) for _ in range(len(event_specs) - 1)]
    simulated_ts = datetime.fromisoformat(fixture["delivered_at"].replace("Z", "+00:00"))

    for index, spec in enumerate(event_specs):
        if index:
            gap = gaps[index - 1]
            if speed:
                time.sleep(gap / speed)
            simulated_ts += timedelta(seconds=gap)

        yield PipelineEvent(
            seq=index + 1,
            ts=simulated_ts,
            **spec,
        )


__all__ = ["PipelineEvent", "stream"]
