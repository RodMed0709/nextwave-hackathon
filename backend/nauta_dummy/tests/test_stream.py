from __future__ import annotations

import json
import random
import sys
import unittest
from contextlib import redirect_stdout
from io import StringIO
from pathlib import Path
from unittest.mock import patch


BACKEND_DIR = Path(__file__).resolve().parents[2]
PACKAGE_DIR = BACKEND_DIR / "nauta_dummy"
sys.path.insert(0, str(BACKEND_DIR))

from nauta_dummy import PipelineEvent, stream  # noqa: E402
from nauta_dummy.__main__ import main  # noqa: E402


EXPECTED_STAGES = [
    "INGEST",
    "EXTRACT",
    "RECONCILE",
    "DETECT",
    "IMPACT",
    "PLAN",
]


class StreamTests(unittest.TestCase):
    def load_fixture(self, name: str) -> dict:
        fixture_path = PACKAGE_DIR / "fixtures" / name
        with fixture_path.open(encoding="utf-8") as fixture_file:
            return json.load(fixture_file)

    def test_each_scenario_emits_the_six_pipeline_stages(self) -> None:
        for scenario in ("run-A", "run-B"):
            with self.subTest(scenario=scenario):
                events = list(stream(scenario=scenario, speed=0, seed=7))

                self.assertEqual(EXPECTED_STAGES, [event.stage for event in events])
                self.assertEqual(list(range(1, 7)), [event.seq for event in events])
                self.assertTrue(all(isinstance(event, PipelineEvent) for event in events))

    def test_impact_cost_matches_each_fixture(self) -> None:
        expected_costs = {"run-A": 0, "run-B": 3780}

        for scenario, expected_cost in expected_costs.items():
            with self.subTest(scenario=scenario):
                impact = list(stream(scenario=scenario, speed=0))[4]
                self.assertEqual(expected_cost, impact.data["estimated_cost_usd"])

    def test_every_evidence_id_exists_in_its_fixture(self) -> None:
        fixtures = {
            "run-A": self.load_fixture("run-A-tranquilo.json"),
            "run-B": self.load_fixture("run-B-problema.json"),
        }

        for scenario, fixture in fixtures.items():
            valid_ids = {
                message["message_id"]
                for message in fixture["operation"]["recent_messages"]
            }
            with self.subTest(scenario=scenario):
                for event in stream(scenario=scenario, speed=0):
                    self.assertTrue(set(event.evidence).issubset(valid_ids))

    def test_speed_zero_never_calls_sleep(self) -> None:
        with patch(
            "nauta_dummy.time.sleep",
            side_effect=AssertionError("speed=0 must not sleep"),
        ):
            events = list(stream(scenario="run-B", speed=0, seed=11))

        self.assertEqual(6, len(events))

    def test_positive_speed_divides_each_seeded_jitter_gap(self) -> None:
        rng = random.Random(23)
        expected_sleeps = [rng.uniform(0.8, 3.5) / 8 for _ in range(5)]

        with patch("nauta_dummy.time.sleep") as sleep:
            list(stream(scenario="run-B", speed=8, seed=23))

        self.assertEqual(
            expected_sleeps,
            [call.args[0] for call in sleep.call_args_list],
        )

    def test_seed_makes_variable_simulated_gaps_reproducible(self) -> None:
        first = list(stream(scenario="run-B", speed=0, seed=23))
        second = list(stream(scenario="run-B", speed=0, seed=23))
        gaps = [
            (current.ts - previous.ts).total_seconds()
            for previous, current in zip(first, first[1:])
        ]

        self.assertEqual([event.ts for event in first], [event.ts for event in second])
        self.assertEqual(5, len(gaps))
        self.assertTrue(all(0.8 <= gap <= 3.5 for gap in gaps))
        self.assertGreater(len(set(gaps)), 1)

    def test_run_a_is_thinner_than_run_b(self) -> None:
        run_a = list(stream(scenario="run-A", speed=0))
        run_b = list(stream(scenario="run-B", speed=0))

        self.assertEqual(1, len(run_a[3].data["alerts"]))
        self.assertEqual("low", run_a[3].data["alerts"][0]["severity"])
        self.assertEqual(3, len(run_b[3].data["alerts"]))
        self.assertEqual({"high"}, {alert["severity"] for alert in run_b[3].data["alerts"]})
        self.assertEqual(1, len(run_a[5].data["options"]))
        self.assertEqual(3, len(run_b[5].data["options"]))

    def test_stage_payloads_expose_the_required_fields(self) -> None:
        events = list(stream(scenario="run-B", speed=0))

        self.assertEqual(
            {"from", "subject", "received_at", "excerpt"},
            set(events[0].data),
        )
        self.assertEqual(
            {"carrier", "vessel", "eta", "eta_previous", "transshipment"},
            set(events[1].data),
        )
        self.assertEqual(
            {"booking_on_file", "received_update", "agree"},
            set(events[2].data),
        )
        self.assertEqual(
            {
                "days_delta",
                "containers_affected",
                "billable_days",
                "estimated_cost_usd",
                "reversible",
                "bill_of_lading_blocks_release",
                "client_commitment_missed",
            },
            set(events[4].data),
        )
        for rank, option in enumerate(events[5].data["options"], start=1):
            self.assertEqual(rank, option["rank"])
            self.assertEqual(
                {"id", "label", "cost_usd", "eta", "rationale", "rank"},
                set(option),
            )

    def test_to_dict_is_json_serializable(self) -> None:
        event = next(stream(scenario="run-A", speed=0))

        serialized = event.to_dict()

        self.assertIsInstance(serialized["ts"], str)
        json.dumps(serialized)

    def test_cli_prints_six_events_and_exits_for_each_scenario(self) -> None:
        for scenario in ("run-A", "run-B"):
            with self.subTest(scenario=scenario):
                output = StringIO()
                with redirect_stdout(output):
                    exit_code = main(
                        ["--scenario", scenario, "--speed", "0", "--seed", "23"]
                    )

                self.assertEqual(0, exit_code)
                self.assertEqual(6, output.getvalue().count("\n["))
                self.assertIn("[6/6]", output.getvalue())


if __name__ == "__main__":
    unittest.main()
