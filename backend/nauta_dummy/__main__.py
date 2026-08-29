"""Human-readable command-line preview for the Nauta simulator."""

from __future__ import annotations

import argparse
import json
from collections.abc import Sequence

from . import SCENARIO_FILES, stream


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Reproduce un escenario simulado de Nauta.")
    parser.add_argument("--scenario", choices=SCENARIO_FILES, default="run-B")
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
    for event in stream(scenario=args.scenario, speed=args.speed, seed=args.seed):
        print(
            f"\n[{event.seq}/6] {event.ts.isoformat()} · {event.stage} · {event.agent}",
            flush=True,
        )
        print(event.title, flush=True)
        print(event.detail, flush=True)
        print(json.dumps(event.data, ensure_ascii=False, indent=2), flush=True)
        print(f"Evidencia: {', '.join(event.evidence)}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
