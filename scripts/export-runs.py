"""Export every run from a deployed Donald API into replayable JSONL files.

Why this exists: the schema lives in this repository, but the runs do not, and
nobody on this team holds the database credentials. Everything the demo depends
on can still be pulled through the public read API, and what comes back is the
event log itself - the same shape `recordedSource` plays. So the backup is not
a dump you would have to restore before it is useful; it is a set of runs you
can replay immediately, from a file, with the API switched off.

    python scripts/export-runs.py
    python scripts/export-runs.py --api https://api.donald.todes.mx --out backup/runs

One file per run, plus an index. Re-running overwrites, so it is safe to repeat.
"""
from __future__ import annotations

import argparse
import json
import os
import socket
import sys
import urllib.error
import urllib.parse
import urllib.request

DEFAULT_API = "https://api.donald.todes.mx"
DEFAULT_OUT = os.path.join("backup", "runs")

# The stream endpoint never closes on its own - it stays open waiting for a live
# agent - so reading is bounded two ways: stop once every event the run claims to
# have has arrived, and give up after this long if it never gets there.
READ_TIMEOUT_SECONDS = 20


def api_root(base: str) -> str:
    base = base.rstrip("/")
    return base if base.endswith("/v1") else base + "/v1"


def get_json(url: str, timeout: int = 30):
    with urllib.request.urlopen(url, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def read_events(root: str, run_key: str, expected: int) -> list[dict]:
    """Read the SSE stream from sequence 0 and return the parsed events."""
    url = f"{root}/runs/{urllib.parse.quote(run_key)}/stream?after=0"
    request = urllib.request.Request(url, headers={"Accept": "text/event-stream"})
    events: list[dict] = []
    buffer = b""
    try:
        with urllib.request.urlopen(request, timeout=READ_TIMEOUT_SECONDS) as response:
            while True:
                chunk = response.read(8192)
                if not chunk:
                    break
                buffer += chunk
                # Parse whole frames only; a partial line is kept for the next read.
                *complete, buffer = buffer.split(b"\n")
                for raw in complete:
                    line = raw.decode("utf-8", "replace").strip()
                    if not line.startswith("data:"):
                        continue
                    try:
                        events.append(json.loads(line[5:].strip()))
                    except json.JSONDecodeError:
                        pass
                if expected and len(events) >= expected:
                    break
    except (socket.timeout, TimeoutError):
        pass  # Bounded read, not a failure: whatever arrived is what there was.
    except urllib.error.URLError as error:
        print(f"    stream failed: {error}", file=sys.stderr)
    events.sort(key=lambda e: e.get("sequence", 0))
    return events


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--api", default=DEFAULT_API)
    parser.add_argument("--out", default=DEFAULT_OUT)
    args = parser.parse_args()

    root = api_root(args.api)
    os.makedirs(args.out, exist_ok=True)

    try:
        runs = get_json(f"{root}/runs").get("runs", [])
    except Exception as error:
        print(f"could not list runs from {root}: {error}", file=sys.stderr)
        return 1

    print(f"{len(runs)} runs at {root}")
    index = []
    for run in runs:
        key = run.get("run_key")
        if not key:
            continue
        expected = run.get("last_sequence") or 0
        events = read_events(root, key, expected)
        short = "complete" if expected and len(events) >= expected else "PARTIAL"
        print(f"  {key:52} {len(events):>3}/{expected:<3} {short}")

        path = os.path.join(args.out, f"{key}.jsonl")
        with open(path, "w", encoding="utf-8", newline="\n") as handle:
            for event in events:
                handle.write(json.dumps(event, ensure_ascii=False) + "\n")

        index.append({
            "run_key": key,
            "name": run.get("name"),
            "status": run.get("status"),
            "summary": run.get("summary"),
            "events": len(events),
            "expected": expected,
            "complete": bool(expected) and len(events) >= expected,
            "started_at": run.get("started_at"),
            "finished_at": run.get("finished_at"),
            "file": f"{key}.jsonl",
        })

    with open(os.path.join(args.out, "index.json"), "w", encoding="utf-8", newline="\n") as handle:
        json.dump({"api": root, "runs": index}, handle, ensure_ascii=False, indent=2)
        handle.write("\n")

    complete = sum(1 for r in index if r["complete"])
    print(f"\n{complete}/{len(index)} complete -> {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
