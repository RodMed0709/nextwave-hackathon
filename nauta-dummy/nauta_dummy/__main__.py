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

    for event in stream(scenario=args.scenario, speed=args.speed, seed=args.seed):
        if args.json:
            print(json.dumps(event.to_dict(), ensure_ascii=False), flush=True)
            continue
        owner = event.agent_label or "provider"
        node = f" · {event.node_key}" if event.node_key else ""
        print(
            f"[{event.sequence}] {event.occurred_at.isoformat()} · "
            f"{event.event_type} · {owner}{node}",
            flush=True,
        )
        print(json.dumps(event.payload, ensure_ascii=False, indent=2), flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
