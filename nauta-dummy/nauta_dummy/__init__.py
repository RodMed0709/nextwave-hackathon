"""Provider-agnostic simulator for the five-verb supervision protocol."""

from __future__ import annotations

import hashlib
import json
import random
import time
from collections.abc import Generator, Iterable
from copy import deepcopy
from dataclasses import asdict, dataclass
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any


EVENT_TYPES = frozenset(
    {
        "run_started",
        "plan_declared",
        "node_added",
        "node_updated",
        "node_status_changed",
        "node_removed",
        "edge_added",
        "edge_updated",
        "edge_removed",
        "artifact_added",
        "intervention_requested",
        "intervention_resolved",
        "run_updated",
        "run_finished",
        "agent_message",
    }
)
ARTIFACT_TYPES = frozenset(
    {"file", "image", "video", "audio", "link", "text", "structured_data"}
)
FIXTURES_DIR = Path(__file__).with_name("fixtures")
Answer = dict[str, Any] | None


@dataclass(frozen=True)
class ProviderEvent:
    sequence: int
    event_type: str
    occurred_at: datetime
    agent_label: str | None
    node_key: str | None
    idempotency_key: str
    payload: dict[str, Any]

    def to_dict(self) -> dict[str, Any]:
        """Return a detached representation ready for an agent_event insert."""
        event = asdict(self)
        event["occurred_at"] = self.occurred_at.isoformat()
        return event


class _Emitter:
    def __init__(self, scenario: dict[str, Any], speed: float, seed: int | None):
        self.scenario_name = scenario["name"]
        self.speed = speed
        self.rng = random.Random(seed)
        self.occurred_at = datetime.fromisoformat(
            scenario["started_at"].replace("Z", "+00:00")
        )
        self.sequence = 0

    def emit(
        self,
        event_type: str,
        *,
        payload: dict[str, Any],
        agent_label: str | None = None,
        node_key: str | None = None,
    ) -> ProviderEvent:
        if event_type not in EVENT_TYPES:
            raise ValueError(f"Unsupported event_type {event_type!r}")
        if self.sequence:
            gap = self.rng.uniform(0.8, 3.5)
            if self.speed:
                time.sleep(gap / self.speed)
            self.occurred_at += timedelta(seconds=gap)
        self.sequence += 1
        detached_payload = deepcopy(payload)
        identity = json.dumps(
            {
                "scenario": self.scenario_name,
                "sequence": self.sequence,
                "event_type": event_type,
                "agent_label": agent_label,
                "node_key": node_key,
                "payload": detached_payload,
            },
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        )
        return ProviderEvent(
            sequence=self.sequence,
            event_type=event_type,
            occurred_at=self.occurred_at,
            agent_label=agent_label,
            node_key=node_key,
            idempotency_key=hashlib.sha256(identity.encode("utf-8")).hexdigest(),
            payload=detached_payload,
        )


def _fixture_scenarios() -> list[tuple[int, str, Path]]:
    scenarios: list[tuple[int, str, Path]] = []
    for path in FIXTURES_DIR.glob("*.json"):
        with path.open(encoding="utf-8") as fixture_file:
            fixture = json.load(fixture_file)
        if "name" in fixture:
            scenarios.append((fixture.get("display_order", 999), fixture["name"], path))
    return sorted(scenarios, key=lambda item: (item[0], item[1]))


def list_scenarios() -> list[str]:
    """Discover scenario names from fixture data."""
    return [name for _, name, _ in _fixture_scenarios()]


def _load_scenario(name: str) -> dict[str, Any]:
    for _, scenario_name, path in _fixture_scenarios():
        if scenario_name == name:
            with path.open(encoding="utf-8") as fixture_file:
                return json.load(fixture_file)
    choices = ", ".join(list_scenarios())
    raise ValueError(f"Unknown scenario {name!r}; expected one of: {choices}")


def _node_payload(node: dict[str, Any], plan_order: int) -> dict[str, Any]:
    payload = {
        key: deepcopy(value)
        for key, value in node.items()
        if key not in {"node_key", "agent_label", "plan_order"}
    }
    payload["planned"] = True
    payload["plan_order"] = node.get("plan_order", plan_order)
    return payload


def _agent_for(node_key: str | None, nodes: dict[str, dict[str, Any]]) -> str | None:
    if node_key is None:
        return None
    node = nodes.get(node_key, {})
    return node.get("agent_label")


def _declare(
    scenario: dict[str, Any], emitter: _Emitter, nodes: dict[str, dict[str, Any]]
) -> Iterable[ProviderEvent]:
    provider = scenario["provider"]
    plan = scenario["plan"]
    yield emitter.emit(
        "run_started",
        payload={
            "scenario": scenario["name"],
            "provider": provider["name"],
            "agents": provider["agents"],
        },
    )
    yield emitter.emit(
        "plan_declared",
        payload={"graph_revision": plan.get("graph_revision", 1), "plan": plan},
    )
    for plan_order, node in enumerate(plan["steps"], start=1):
        nodes[node["node_key"]] = deepcopy(node)
        yield emitter.emit(
            "node_added",
            agent_label=node.get("agent_label"),
            node_key=node["node_key"],
            payload=_node_payload(node, plan_order),
        )
    for edge in plan.get("edges", []):
        yield emitter.emit("edge_added", payload={**deepcopy(edge), "planned": True})


def _advance(
    action: dict[str, Any], emitter: _Emitter, nodes: dict[str, dict[str, Any]]
) -> Iterable[ProviderEvent]:
    node_key = action["node_key"]
    agent_label = action.get("agent_label") or _agent_for(node_key, nodes)
    yield emitter.emit(
        "node_status_changed",
        agent_label=agent_label,
        node_key=node_key,
        payload={"status": "in_progress"},
    )
    if "update" in action:
        yield emitter.emit(
            "node_updated",
            agent_label=agent_label,
            node_key=node_key,
            payload=action["update"],
        )
    for artifact in action.get("artifacts", []):
        artifact_type = artifact.get("artifact_type")
        if artifact_type not in ARTIFACT_TYPES:
            raise ValueError(f"Unsupported artifact_type {artifact_type!r}")
        if "text_content" not in artifact and "url" not in artifact:
            raise ValueError("An artifact requires text_content or url")
        yield emitter.emit(
            "artifact_added",
            agent_label=agent_label,
            node_key=node_key,
            payload=artifact,
        )
    yield emitter.emit(
        "node_status_changed",
        agent_label=agent_label,
        node_key=node_key,
        payload={"status": action.get("status", "succeeded")},
    )


def _replan(
    action: dict[str, Any], emitter: _Emitter, nodes: dict[str, dict[str, Any]]
) -> Iterable[ProviderEvent]:
    for removed in action.get("remove_nodes", []):
        node_key = removed["node_key"]
        yield emitter.emit(
            "node_removed",
            agent_label=_agent_for(node_key, nodes),
            node_key=node_key,
            payload={key: value for key, value in removed.items() if key != "node_key"},
        )
    for edge in action.get("remove_edges", []):
        yield emitter.emit("edge_removed", payload=edge)
    for plan_order, node in enumerate(action.get("add_nodes", []), start=1):
        nodes[node["node_key"]] = deepcopy(node)
        yield emitter.emit(
            "node_added",
            agent_label=node.get("agent_label"),
            node_key=node["node_key"],
            payload=_node_payload(node, plan_order),
        )
    for edge in action.get("add_edges", []):
        yield emitter.emit("edge_added", payload={**deepcopy(edge), "planned": True})
    yield emitter.emit(
        "run_updated",
        payload={
            "graph_revision": action["graph_revision"],
            "reason": action.get("reason"),
        },
    )


def _execute(
    actions: list[dict[str, Any]],
    emitter: _Emitter,
    nodes: dict[str, dict[str, Any]],
) -> Generator[ProviderEvent, Answer, None]:
    for action in actions:
        verb = action["verb"]
        if verb == "advance":
            yield from _advance(action, emitter, nodes)
        elif verb == "replan":
            yield from _replan(action, emitter, nodes)
        elif verb == "ask":
            request = action["request"]
            node_key = action.get("node_key")
            answer = yield emitter.emit(
                "intervention_requested",
                agent_label=action.get("agent_label") or _agent_for(node_key, nodes),
                node_key=node_key,
                payload={
                    "type": request["type"],
                    "prompt": request["prompt"],
                    "options": request["options"],
                },
            )
            used_default = answer is None
            option_id = (
                request["default_option_id"]
                if used_default
                else answer.get("option_id")
            )
            options = {option["id"]: option for option in request["options"]}
            if option_id not in options:
                raise ValueError(f"Unknown option_id {option_id!r}")
            branch_id = options[option_id].get("branch", option_id)
            try:
                branch = action["branches"][branch_id]
            except KeyError as error:
                raise ValueError(f"No branch {branch_id!r} for option {option_id!r}") from error
            yield emitter.emit(
                "intervention_resolved",
                agent_label=action.get("agent_label") or _agent_for(node_key, nodes),
                node_key=node_key,
                payload={
                    "option_id": option_id,
                    "branch_id": branch_id,
                    "used_default": used_default,
                },
            )
            yield from _execute(branch, emitter, nodes)
        elif verb == "finish":
            yield emitter.emit("run_finished", payload={"summary": action["summary"]})
        else:
            raise ValueError(f"Unsupported verb {verb!r}")


def stream(
    scenario: str,
    speed: float = 1.0,
    seed: int | None = None,
) -> Generator[ProviderEvent, Answer, None]:
    """Yield one finite provider run, accepting a decision after ASK."""
    if speed < 0:
        raise ValueError("speed must be non-negative")
    scenario_data = _load_scenario(scenario)
    emitter = _Emitter(scenario_data, speed, seed)
    nodes: dict[str, dict[str, Any]] = {}
    yield from _declare(scenario_data, emitter, nodes)
    yield from _execute(scenario_data["timeline"], emitter, nodes)


__all__ = ["EVENT_TYPES", "ProviderEvent", "list_scenarios", "stream"]
