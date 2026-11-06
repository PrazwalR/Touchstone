"""Boundary checks for release gates, including dependency coverage exclusion."""

from __future__ import annotations

import contextlib
import io
import json
import tempfile
import unittest
from pathlib import Path

import check_release_gates as gates


class ReleaseGatesTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        root, contracts = gates.ROOT, gates.CONTRACTS
        self.addCleanup(setattr, gates, "ROOT", root)
        self.addCleanup(setattr, gates, "CONTRACTS", contracts)
        gates.ROOT = Path(self.temp.name)
        gates.CONTRACTS = gates.ROOT / "contracts"
        (gates.CONTRACTS / "src").mkdir(parents=True)
        self.output = contextlib.redirect_stdout(io.StringIO())
        self.output.__enter__()
        self.addCleanup(self.output.__exit__, None, None, None)

    def write_coverage(self, hits: int) -> None:
        (gates.CONTRACTS / "lcov.info").write_text(
            f"SF:src/Hook.sol\nLF:100\nLH:{hits}\nBRF:100\nBRH:{hits}\nend_of_record\n"
            "SF:lib/dependency/src/Hook.sol\nLF:100000\nLH:100000\nBRF:100000\nBRH:100000\nend_of_record\n"
        )

    def test_coverage_accepts_exactly_95_percent(self) -> None:
        self.write_coverage(95)
        gates.coverage()

    def test_dependency_coverage_cannot_hide_insufficient_project_coverage(self) -> None:
        self.write_coverage(94)
        with self.assertRaises(SystemExit):
            gates.coverage()

    def write_review(self, entries: list[dict[str, object]]) -> None:
        (gates.ROOT / "docs" / "audits").mkdir(parents=True, exist_ok=True)
        (gates.ROOT / gates.COVERAGE_REVIEW).write_text(json.dumps(entries))

    def write_mapped_coverage(self) -> None:
        # 20 lines, 19 hit; 20 branches, 19 hit; the miss is on line 7 in both.
        (gates.CONTRACTS / "src" / "Hook.sol").write_text("\n".join(f"line {i}" for i in range(1, 21)) + "\n")
        das = "".join(f"DA:{i},{0 if i == 7 else 1}\n" for i in range(1, 21))
        brdas = "".join(f"BRDA:{i},0,0,{'-' if i == 7 else 1}\n" for i in range(1, 21))
        (gates.CONTRACTS / "lcov.info").write_text(
            f"SF:src/Hook.sol\n{das}LF:20\nLH:19\n{brdas}BRF:20\nBRH:19\nend_of_record\n"
        )

    def review_entry(self, **overrides: object) -> dict[str, object]:
        entry: dict[str, object] = {
            "file": "src/Hook.sol",
            "line": 7,
            "kind": "line",
            "category": "executed",
            "source": "line 7",
            "reason": "via-IR source map",
            "evidence": "test_X",
        }
        entry.update(overrides)
        return entry

    def test_coverage_review_excludes_only_reviewed_misses(self) -> None:
        self.write_mapped_coverage()
        self.write_review([self.review_entry(), self.review_entry(kind="branch")])
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            gates.coverage()
        self.assertIn("LH/LF: 19/19", out.getvalue())
        self.assertIn("BRH/BRF: 19/19", out.getvalue())

    def test_coverage_review_is_voided_by_an_edited_line(self) -> None:
        self.write_mapped_coverage()
        self.write_review([self.review_entry(source="line 7 before the edit")])
        with self.assertRaises(SystemExit):
            gates.coverage()

    def test_coverage_review_needs_evidence_and_a_known_category(self) -> None:
        self.write_mapped_coverage()
        for bad in (self.review_entry(evidence=""), self.review_entry(category="convenient")):
            self.write_review([bad])
            with self.assertRaises(SystemExit):
                gates.coverage()

    def test_missing_project_coverage_fails(self) -> None:
        (gates.CONTRACTS / "lcov.info").write_text("")
        with self.assertRaises(SystemExit):
            gates.coverage()

    def test_gas_accepts_exactly_five_percent_but_rejects_six(self) -> None:
        baseline = gates.ROOT / "docs/audits/m0-m5-repair-2026-10-30"
        baseline.mkdir(parents=True)
        (baseline / "gas-before.json").write_text(json.dumps({"settle": "100"}))
        snapshots = gates.CONTRACTS / "snapshots"
        snapshots.mkdir()
        result = snapshots / "SwapGasTest.json"
        result.write_text(json.dumps({"settle": "105"}))
        gates.gas()
        result.write_text(json.dumps({"settle": "106"}))
        with self.assertRaises(SystemExit):
            gates.gas()

    def write_gas(self, baseline: dict[str, str], measured: dict[str, str], approved: dict | None = None) -> None:
        audits = gates.ROOT / "docs/audits"
        (audits / "m0-m5-repair-2026-10-30").mkdir(parents=True)
        (audits / "m0-m5-repair-2026-10-30/gas-before.json").write_text(json.dumps(baseline))
        if approved is not None:
            (audits / "gas-approved-baselines.json").write_text(json.dumps(approved))
        (gates.CONTRACTS / "snapshots").mkdir()
        (gates.CONTRACTS / "snapshots/SwapGasTest.json").write_text(json.dumps(measured))

    def test_gas_approved_baseline_moves_only_its_own_path(self) -> None:
        approved = {"settle": {"baseline": 200, "decision": "0042"}}
        self.write_gas({"settle": "100", "swap": "100"}, {"settle": "210", "swap": "105"}, approved)
        gates.gas()

    def test_gas_approved_baseline_still_enforces_the_tolerance(self) -> None:
        approved = {"settle": {"baseline": 200, "decision": "0042"}}
        self.write_gas({"settle": "100"}, {"settle": "211"}, approved)
        with self.assertRaises(SystemExit):
            gates.gas()

    def test_gas_approval_does_not_cover_other_paths(self) -> None:
        approved = {"settle": {"baseline": 200, "decision": "0042"}}
        self.write_gas({"settle": "100", "swap": "100"}, {"settle": "200", "swap": "106"}, approved)
        with self.assertRaises(SystemExit):
            gates.gas()

    def test_gas_approval_requires_a_decision_and_a_known_path(self) -> None:
        self.write_gas({"settle": "100"}, {"settle": "100"}, {"settle": {"baseline": 200, "decision": ""}})
        with self.assertRaises(SystemExit):
            gates.gas()
        (gates.ROOT / "docs/audits/gas-approved-baselines.json").write_text(
            json.dumps({"nonexistent": {"baseline": 1, "decision": "0042"}})
        )
        with self.assertRaises(SystemExit):
            gates.gas()

    def test_static_analysis_rejects_unreviewed_findings_and_failed_runs(self) -> None:
        baseline = gates.ROOT / "docs/audits/m0-m5-repair-2026-10-30"
        baseline.mkdir(parents=True)
        (baseline / "slither-reviewed.json").write_text(json.dumps([{"id": "reviewed"}]))
        result = gates.ROOT / "slither.json"
        old_args = gates.sys.argv
        self.addCleanup(setattr, gates.sys, "argv", old_args)
        gates.sys.argv = ["check", "slither", str(result)]
        result.write_text(json.dumps({"success": True, "results": {"detectors": [{"id": "reviewed"}]}}))
        gates.slither()
        result.write_text(json.dumps({"success": True, "results": {"detectors": [{"id": "new"}]}}))
        with self.assertRaises(SystemExit):
            gates.slither()
        result.write_text(json.dumps({"success": False}))
        with self.assertRaises(SystemExit):
            gates.slither()


if __name__ == "__main__":
    unittest.main()
