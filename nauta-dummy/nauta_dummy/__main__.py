"""Command-line preview for provider protocol scenarios."""

from __future__ import annotations

import argparse
import json
from collections.abc import Sequence

from . import list_scenarios, stream


def _parser() -> argparse.ArgumentParser:
    scenarios = list_scenarios()
    parser = argparse.ArgumentParser(
        description="Reproduce un escenario de proveedor supervisable."
    )
    parser.add_argument("--scenario", choices=scenarios, default=scenarios[0])
    parser.add_argument("--list", action="store_true", help="Lista los escenarios.")
    parser.add_argument(
        "--json",
        action="store_true",
        help="Emite un objeto JSON por línea.",
    )
    parser.add_argument(
        "--speed",
        type=float,
        default=1.0,
        help="Multiplicador de reproducción; 0 elimina las pausas.",
    )
    parser.add_argument("--seed", type=int, default=None, help="Semilla para repetir el ritmo.")
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    if args.list:
        for scenario in list_scenarios():
            print(scenario)
        return 0

    proposal_agent = "El proveedor"
    for event in stream(scenario=args.scenario, speed=args.speed, seed=args.seed):
        if args.json:
            print(json.dumps(event.to_dict(), ensure_ascii=False), flush=True)
            continue
        owner = event.agent_label or "proveedor"
        node = f" · {event.node_key}" if event.node_key else ""
        print(
            f"[{event.sequence}] {event.occurred_at.isoformat()} · "
            f"{event.event_type} · {owner}{node}",
            flush=True,
        )
        if event.event_type == "plan_declared":
            steps = event.payload["plan"]["steps"]
            if steps and steps[0].get("agent_label"):
                proposal_agent = steps[0]["agent_label"]
            print(f"{proposal_agent} propone {len(steps)} pasos", flush=True)
        elif event.event_type == "run_updated":
            evidence = ", ".join(event.payload["evidence"])
            print(
                f"{proposal_agent} replantea: {event.payload['reason']}",
                flush=True,
            )
            print(
                f"  ▸ triggered_by: {event.payload['triggered_by']} · "
                f"evidence: {evidence}",
                flush=True,
            )
        print(json.dumps(event.payload, ensure_ascii=False, indent=2), flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
