from __future__ import annotations

import json
import random
import sys
import unittest
from contextlib import redirect_stdout
from dataclasses import FrozenInstanceError
from io import StringIO
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch


PACKAGE_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PACKAGE_ROOT))

from nauta_dummy import EVENT_TYPES, ProviderEvent, list_scenarios, stream  # noqa: E402
from nauta_dummy.__main__ import main  # noqa: E402


REQUIRED_SCENARIOS = (
    "nauta-shipment-quiet",
    "nauta-shipment-delay",
    "payments-reconciliation",
)
EXPECTED_EVENT_TYPES = {
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


def collect_with_answer(scenario: str, option_id: str) -> list[ProviderEvent]:
    generator = stream(scenario=scenario, speed=0, seed=23)
    events: list[ProviderEvent] = []
    while True:
        try:
            event = next(generator)
        except StopIteration:
            return events
        events.append(event)
        if event.event_type == "intervention_requested":
            try:
                events.append(generator.send({"option_id": option_id}))
            except StopIteration:
                return events


def all_strings(value: object) -> list[str]:
    if isinstance(value, dict):
        return [text for item in value.values() for text in all_strings(item)]
    if isinstance(value, (list, tuple)):
        return [text for item in value for text in all_strings(item)]
    return [value] if isinstance(value, str) else []


class StreamTests(unittest.TestCase):
    def test_every_scenario_has_a_valid_finite_envelope(self) -> None:
        scenarios = tuple(list_scenarios())
        self.assertTrue(set(REQUIRED_SCENARIOS).issubset(scenarios))

        for scenario in scenarios:
            with self.subTest(scenario=scenario):
                events = list(stream(scenario=scenario, speed=0, seed=7))

                self.assertEqual("run_started", events[0].event_type)
                self.assertEqual("run_finished", events[-1].event_type)
                self.assertEqual(
                    list(range(1, len(events) + 1)),
                    [event.sequence for event in events],
                )
                self.assertTrue(all(event.event_type in EVENT_TYPES for event in events))
                self.assertTrue(all(isinstance(event, ProviderEvent) for event in events))

    def test_event_type_enum_matches_the_database_exactly(self) -> None:
        self.assertEqual(EXPECTED_EVENT_TYPES, EVENT_TYPES)

    def test_provider_event_matches_database_row_and_is_frozen(self) -> None:
        event = next(stream("nauta-shipment-quiet", speed=0))

        self.assertEqual(
            {
                "sequence",
                "event_type",
                "occurred_at",
                "agent_label",
                "node_key",
                "idempotency_key",
                "payload",
            },
            set(event.to_dict()),
        )
        with self.assertRaises(FrozenInstanceError):
            event.sequence = 99  # type: ignore[misc]
        with self.assertRaises(TypeError):
            event.payload["provider"] = "otro"
        with self.assertRaises(TypeError):
            event.payload["agents"][0]["label"] = "otra"
        json.dumps(event.to_dict())

    def test_replan_assigns_unique_orders_when_fixture_omits_them(self) -> None:
        scenario = {
            "name": "order-regression",
            "started_at": "2026-08-29T12:00:00Z",
            "provider": {"name": "Prueba", "agents": []},
            "plan": {
                "graph_revision": 1,
                "basis": "flujo de prueba conocido",
                "steps": [
                    {"node_key": "first", "label": "Primero"},
                    {"node_key": "second", "label": "Segundo"},
                ],
                "edges": [],
            },
            "timeline": [
                {
                    "verb": "advance",
                    "node_key": "first",
                    "update": {"finding": "El primer paso exige ajustar la propuesta."},
                },
                {
                    "verb": "replan",
                    "graph_revision": 2,
                    "reason": "El primer paso reveló que hacen falta dos pasos nuevos.",
                    "triggered_by": "first",
                    "evidence": ["MSG-TEST-1"],
                    "remove_nodes": [{"node_key": "second"}],
                    "add_nodes": [
                        {"node_key": "third", "label": "Tercero"},
                        {"node_key": "fourth", "label": "Cuarto"},
                    ],
                },
                {"verb": "finish", "summary": {"headline": "Listo"}},
            ],
        }

        with patch("nauta_dummy._load_scenario", return_value=scenario):
            events = list(stream("order-regression", speed=0))

        orders = [
            event.payload["plan_order"]
            for event in events
            if event.event_type == "node_added"
        ]
        self.assertEqual([1, 2, 2, 3], orders)

    def test_declare_emits_plan_then_each_node_then_edges(self) -> None:
        for scenario in list_scenarios():
            with self.subTest(scenario=scenario):
                events = list(stream(scenario, speed=0))
                declaration_index = next(
                    index
                    for index, event in enumerate(events)
                    if event.event_type == "plan_declared"
                )
                plan = events[declaration_index].payload["plan"]
                declared_nodes = events[
                    declaration_index + 1 : declaration_index + 1 + len(plan["steps"])
                ]

                self.assertEqual(
                    ["node_added"] * len(plan["steps"]),
                    [event.event_type for event in declared_nodes],
                )
                self.assertEqual(
                    list(range(1, len(plan["steps"]) + 1)),
                    [event.payload["plan_order"] for event in declared_nodes],
                )
                self.assertTrue(all(event.payload["planned"] for event in declared_nodes))
                edge_events = events[
                    declaration_index
                    + 1
                    + len(plan["steps"]) : declaration_index
                    + 1
                    + len(plan["steps"])
                    + len(plan["edges"])
                ]
                self.assertEqual(
                    ["edge_added"] * len(plan["edges"]),
                    [event.event_type for event in edge_events],
                )

    def test_declared_plan_is_explicitly_a_revisable_proposal(self) -> None:
        for scenario in list_scenarios():
            with self.subTest(scenario=scenario):
                declaration = next(
                    event
                    for event in stream(scenario, speed=0)
                    if event.event_type == "plan_declared"
                )

                self.assertIs(True, declaration.payload["proposed"])
                self.assertIs(True, declaration.payload["revisable"])
                self.assertTrue(declaration.payload["basis"].strip())

    def test_every_replan_is_justified_by_an_existing_prior_finding(self) -> None:
        runs = [
            list(stream("nauta-shipment-quiet", speed=0)),
            list(stream("nauta-shipment-delay", speed=0)),
            collect_with_answer("nauta-shipment-delay", "notify-client"),
            list(stream("payments-reconciliation", speed=0)),
        ]

        for events in runs:
            known_nodes: set[str] = set()
            findings: set[str] = set()
            removal_pending = False
            for event in events:
                if event.event_type == "node_added" and event.node_key:
                    known_nodes.add(event.node_key)
                elif (
                    event.event_type == "node_updated"
                    and event.node_key
                    and event.payload.get("finding", "").strip()
                ):
                    findings.add(event.node_key)
                elif event.event_type == "node_removed":
                    removal_pending = True
                elif event.event_type == "run_updated" and removal_pending:
                    reason = event.payload["reason"]
                    triggered_by = event.payload["triggered_by"]
                    evidence = event.payload["evidence"]
                    self.assertTrue(reason.strip())
                    self.assertIn(triggered_by, known_nodes)
                    self.assertIn(triggered_by, findings)
                    self.assertTrue(evidence)
                    removal_pending = False

    def test_loading_replan_without_required_cause_raises(self) -> None:
        scenario = {
            "name": "invalid-replan",
            "started_at": "2026-08-29T12:00:00Z",
            "provider": {"name": "Prueba", "agents": []},
            "plan": {
                "graph_revision": 1,
                "basis": "flujo de prueba conocido",
                "steps": [{"node_key": "detect", "label": "Detectar"}],
                "edges": [],
            },
            "timeline": [
                {
                    "verb": "advance",
                    "node_key": "detect",
                    "update": {"finding": "Apareció una excepción."},
                },
                {
                    "verb": "replan",
                    "graph_revision": 2,
                    "reason": "La excepción exige cambiar de curso.",
                    "triggered_by": "detect",
                    "evidence": ["MSG-TEST-1"],
                    "remove_nodes": [],
                    "add_nodes": [],
                },
                {"verb": "finish", "summary": {"headline": "Listo"}},
            ],
        }

        for missing_field in ("reason", "triggered_by", "evidence"):
            with self.subTest(missing_field=missing_field), TemporaryDirectory() as tmp:
                invalid = json.loads(json.dumps(scenario))
                invalid["timeline"][1].pop(missing_field)
                fixture_path = Path(tmp) / "invalid-replan.json"
                fixture_path.write_text(
                    json.dumps(invalid, ensure_ascii=False), encoding="utf-8"
                )
                with patch("nauta_dummy.FIXTURES_DIR", Path(tmp)):
                    with self.assertRaisesRegex(
                        ValueError, rf"replan.*{missing_field}"
                    ):
                        next(stream("invalid-replan", speed=0))

    def test_cli_uses_proposal_and_learning_copy_without_va_a_hacer(self) -> None:
        for scenario in list_scenarios():
            output = StringIO()
            with redirect_stdout(output):
                main(["--scenario", scenario, "--speed", "0"])

            self.assertNotIn("va a hacer", output.getvalue().lower())

        delay_output = StringIO()
        with redirect_stdout(delay_output):
            main(["--scenario", "nauta-shipment-delay", "--speed", "0"])
        rendered = delay_output.getvalue()
        self.assertIn("Nina propone 5 pasos", rendered)
        self.assertIn("Nina replantea:", rendered)

        for fixture_path in Path(__file__).parents[1].joinpath("fixtures").glob("*.json"):
            fixture = json.loads(fixture_path.read_text(encoding="utf-8"))
            self.assertNotIn(
                "va a hacer",
                "\n".join(all_strings(fixture)).lower(),
                fixture_path.name,
            )

    def test_advance_emits_progress_findings_and_real_artifact(self) -> None:
        events = list(stream("nauta-shipment-delay", speed=0))

        statuses = [
            event.payload["status"]
            for event in events
            if event.event_type == "node_status_changed"
        ]
        self.assertIn("in_progress", statuses)
        self.assertIn("succeeded", statuses)
        self.assertTrue(any(event.event_type == "node_updated" for event in events))
        email = next(
            event
            for event in events
            if event.event_type == "artifact_added"
            and event.payload["name"] == "Vessel change MSC AURORA FE2431"
        )
        self.assertEqual("text", email.payload["artifact_type"])
        self.assertEqual("message/rfc822", email.payload["content_type"])
        self.assertIn("Cargo rolled to MSC LIVORNO", email.payload["text_content"])

    def test_replan_removes_before_adding_and_increments_revision(self) -> None:
        events = list(stream("nauta-shipment-delay", speed=0))
        removed_index = next(
            index for index, event in enumerate(events) if event.event_type == "node_removed"
        )
        added_index = next(
            index
            for index, event in enumerate(events[removed_index + 1 :], removed_index + 1)
            if event.event_type == "node_added"
        )
        revision = next(
            event.payload["graph_revision"]
            for event in events[added_index + 1 :]
            if event.event_type == "run_updated"
        )

        self.assertLess(removed_index, added_index)
        self.assertEqual(2, revision)
        self.assertTrue(
            any(
                event.event_type == "edge_removed"
                for event in events[removed_index:added_index]
            )
        )

    def test_two_send_answers_select_visibly_different_tails(self) -> None:
        quote_events = collect_with_answer("nauta-shipment-delay", "quote-alternatives")
        notify_events = collect_with_answer("nauta-shipment-delay", "notify-client")
        quote_request = next(
            index
            for index, event in enumerate(quote_events)
            if event.event_type == "intervention_requested"
        )
        notify_request = next(
            index
            for index, event in enumerate(notify_events)
            if event.event_type == "intervention_requested"
        )
        quote_tail = [
            (event.event_type, event.node_key, event.payload)
            for event in quote_events[quote_request + 1 :]
        ]
        notify_tail = [
            (event.event_type, event.node_key, event.payload)
            for event in notify_events[notify_request + 1 :]
        ]

        self.assertNotEqual(quote_tail, notify_tail)
        self.assertTrue(any(event.node_key == "quote-carriers" for event in quote_events))
        self.assertTrue(any(event.node_key == "notify-client" for event in notify_events))
        self.assertEqual("run_finished", quote_events[-1].event_type)
        self.assertEqual("run_finished", notify_events[-1].event_type)

    def test_plain_iteration_uses_the_default_branch(self) -> None:
        events = list(stream("nauta-shipment-delay", speed=0))
        resolution = next(
            event for event in events if event.event_type == "intervention_resolved"
        )

        self.assertEqual("quote-alternatives", resolution.payload["option_id"])
        self.assertTrue(resolution.payload["used_default"])

    def test_idempotency_keys_and_timestamps_are_stable_with_same_seed(self) -> None:
        first = list(stream("nauta-shipment-delay", speed=0, seed=23))
        second = list(stream("nauta-shipment-delay", speed=0, seed=23))

        self.assertEqual(
            [event.idempotency_key for event in first],
            [event.idempotency_key for event in second],
        )
        self.assertEqual(
            [event.occurred_at for event in first],
            [event.occurred_at for event in second],
        )
        self.assertEqual(len(first), len(set(event.idempotency_key for event in first)))

    def test_speed_zero_does_not_sleep(self) -> None:
        with patch(
            "nauta_dummy.time.sleep",
            side_effect=AssertionError("speed=0 must not sleep"),
        ):
            list(stream("payments-reconciliation", speed=0, seed=11))

    def test_positive_speed_scales_seeded_variable_jitter(self) -> None:
        events = list(stream("nauta-shipment-quiet", speed=0, seed=23))
        rng = random.Random(23)
        expected = [rng.uniform(0.8, 3.5) / 8 for _ in range(len(events) - 1)]

        with patch("nauta_dummy.time.sleep") as sleep:
            list(stream("nauta-shipment-quiet", speed=8, seed=23))

        self.assertEqual(expected, [call.args[0] for call in sleep.call_args_list])
        self.assertTrue(all(0.8 / 8 <= value <= 3.5 / 8 for value in expected))
        self.assertGreater(len(set(expected)), 1)

    def test_payments_uses_the_generic_protocol_with_different_agents(self) -> None:
        payments = list(stream("payments-reconciliation", speed=0))
        logistics = list(stream("nauta-shipment-delay", speed=0))

        payment_agents = {event.agent_label for event in payments if event.agent_label}
        logistics_agents = {event.agent_label for event in logistics if event.agent_label}
        self.assertIn("Mara", payment_agents)
        self.assertTrue(payment_agents.isdisjoint(logistics_agents))
        self.assertTrue(
            any(
                event.event_type == "intervention_requested"
                and "PSP" in event.payload["prompt"]
                for event in payments
            )
        )

    def test_cli_lists_scenarios_and_streams_json_lines(self) -> None:
        listing = StringIO()
        with redirect_stdout(listing):
            list_exit = main(["--list"])

        self.assertEqual(0, list_exit)
        listed = listing.getvalue().splitlines()
        self.assertTrue(set(REQUIRED_SCENARIOS).issubset(listed))
        self.assertEqual(len(listed), len(set(listed)))

        output = StringIO()
        with redirect_stdout(output):
            run_exit = main(
                [
                    "--scenario",
                    "payments-reconciliation",
                    "--speed",
                    "0",
                    "--seed",
                    "23",
                    "--json",
                ]
            )

        lines = output.getvalue().splitlines()
        decoded = [json.loads(line) for line in lines]
        self.assertEqual(0, run_exit)
        self.assertEqual("run_started", decoded[0]["event_type"])
        self.assertEqual("run_finished", decoded[-1]["event_type"])
        self.assertEqual(len(lines), len(decoded))

    def test_invalid_inputs_fail_clearly(self) -> None:
        with self.assertRaisesRegex(ValueError, "Escenario desconocido"):
            next(stream("missing", speed=0))
        with self.assertRaisesRegex(ValueError, "no puede ser negativo"):
            next(stream("nauta-shipment-quiet", speed=-1))


if __name__ == "__main__":
    unittest.main()
