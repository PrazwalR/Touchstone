"""Enforce the recorded size, coverage and gas gates without resetting their baselines."""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CONTRACTS = ROOT / "contracts"
SIZE_LIMIT = 24_576
COVERAGE_MIN = 0.95
GAS_TOLERANCE_PERCENT = 5


def sizes() -> None:
    for name in ("TouchstoneHook", "Settler", "TouchstoneFactory", "RebateLedger", "LicenceAuction", "TouchstoneLens"):
        artifact = json.loads((CONTRACTS / "out" / f"{name}.sol" / f"{name}.json").read_text())
        size = len(bytes.fromhex(artifact["deployedBytecode"]["object"].removeprefix("0x")))
        print(f"{name}: {size} bytes")
        if not 0 < size < SIZE_LIMIT:
            raise SystemExit(f"{name} fails the runtime size gate")


def gas() -> None:
    """Judge each path against its approved baseline, else against the pre-repair measurement.

    An approval is a per-path entry that names the decision record that accepted the cost. It moves that one
    path's baseline; the 5% tolerance still applies on top of it, and every other path keeps the original.
    """
    baseline = json.loads((ROOT / "docs/audits/m0-m5-repair-2026-10-30/gas-before.json").read_text())
    approved_file = ROOT / "docs/audits/gas-approved-baselines.json"
    approved = json.loads(approved_file.read_text()) if approved_file.exists() else {}
    measured = json.loads((CONTRACTS / "snapshots/SwapGasTest.json").read_text())
    unknown = sorted(set(approved) - set(baseline))
    if unknown:
        raise SystemExit(f"Approved gas baselines for unknown paths: {', '.join(unknown)}")
    failed = False
    for path, original in baseline.items():
        entry = approved.get(path)
        if entry is not None and not (entry.get("decision") and int(entry.get("baseline", 0)) > 0):
            raise SystemExit(f"{path}: an approved baseline must name its decision and a positive baseline")
        old = entry["baseline"] if entry is not None else original
        current = int(measured[path])
        change = current / int(old) - 1
        note = f" [approved baseline, decision {entry['decision']}]" if entry is not None else ""
        print(f"{path}: {old} -> {current} ({change:+.2%}){note}")
        failed |= current <= 0 or current * 100 > int(old) * (100 + GAS_TOLERANCE_PERCENT)
    if failed:
        raise SystemExit("Gas regression exceeds 5%; baseline approval is required, not an automatic reset")


COVERAGE_REVIEW = "docs/audits/coverage-reviewed.json"
REVIEW_CATEGORIES = {"executed", "unreachable"}


def _coverage_review() -> dict[tuple[str, int, str], dict[str, str]]:
    """Reviewed lines and branches the coverage tool reports as missed (decision 0059).

    "executed": a named test proves the code runs, but forge coverage under --ir-minimum loses its source mapping.
    "unreachable": a defensive check no input can reach, with the reason. Each entry pins the line's exact source
    text, so editing the line voids the review, as a changed Slither fingerprint does.
    """
    path = ROOT / COVERAGE_REVIEW
    if not path.exists():
        return {}
    review: dict[tuple[str, int, str], dict[str, str]] = {}
    for item in json.loads(path.read_text()):
        file, line, kind = item["file"], int(item["line"]), item["kind"]
        if kind not in {"line", "branch"} or item["category"] not in REVIEW_CATEGORIES:
            raise SystemExit(f"invalid coverage review entry {file}:{line}")
        if not item.get("reason") or not item.get("evidence"):
            raise SystemExit(f"coverage review entry {file}:{line} needs a reason and evidence")
        source = (CONTRACTS / file).read_text().splitlines()
        if line > len(source) or source[line - 1].strip() != item["source"].strip():
            raise SystemExit(f"stale coverage review: {file}:{line} changed since it was reviewed")
        review[(file, line, kind)] = item
    return review


def coverage() -> None:
    review = _coverage_review()
    totals = dict.fromkeys(("LF", "LH", "BRF", "BRH"), 0)
    reviewed = {"line": 0, "branch": 0}
    for record in (CONTRACTS / "lcov.info").read_text().split("end_of_record"):
        lines = record.strip().splitlines()
        source = next((line[3:] for line in lines if line.startswith("SF:")), None)
        if source is None:
            continue
        path = Path(source)
        path = path.resolve() if path.is_absolute() else (CONTRACTS / path).resolve()
        # Resolve both sides: on macOS a temporary CONTRACTS under /var resolves to /private/var.
        if not path.is_relative_to((CONTRACTS / "src").resolve()):
            continue
        rel = path.relative_to(CONTRACTS.resolve()).as_posix()
        for line in lines:
            key, _, value = line.partition(":")
            if key in totals:
                totals[key] += int(value)
            elif key == "DA":
                number, hits = value.split(",")[:2]
                if hits == "0" and (rel, int(number), "line") in review:
                    totals["LF"] -= 1
                    reviewed["line"] += 1
            elif key == "BRDA":
                number, *_, hits = value.split(",")
                if hits in {"0", "-"} and (rel, int(number), "branch") in review:
                    totals["BRF"] -= 1
                    reviewed["branch"] += 1
    raw_lines = f"{totals['LH']}/{totals['LF'] + reviewed['line']}"
    raw_branches = f"{totals['BRH']}/{totals['BRF'] + reviewed['branch']}"
    print(f"Measured before review: lines {raw_lines}, branches {raw_branches}")
    for hit, found in (("LH", "LF"), ("BRH", "BRF")):
        if not totals[found]:
            raise SystemExit(f"Missing src coverage evidence: {found}")
        ratio = totals[hit] / totals[found]
        print(f"{hit}/{found}: {totals[hit]}/{totals[found]} ({ratio:.2%})")
    print(f"Reviewed and excluded: {reviewed['line']} lines, {reviewed['branch']} branches ({COVERAGE_REVIEW})")
    if any(totals[h] / totals[f] < COVERAGE_MIN for h, f in (("LH", "LF"), ("BRH", "BRF"))):
        raise SystemExit("src coverage is below the required 95% lines and branches")


def slither() -> None:
    if len(sys.argv) != 3:
        raise SystemExit("slither mode requires a results JSON path")
    actual = json.loads(Path(sys.argv[2]).read_text())
    if actual.get("success") is not True:
        raise SystemExit("Slither did not complete successfully")
    reviewed = json.loads((ROOT / "docs/audits/m0-m5-repair-2026-10-30/slither-reviewed.json").read_text())
    approved_ids = {item["id"] for item in reviewed}
    findings = actual["results"].get("detectors", [])
    unknown = [finding for finding in findings if finding["id"] not in approved_ids]
    print(f"Slither: {len(findings)} findings, {len(unknown)} unreviewed fingerprints")
    if unknown:
        raise SystemExit("New or changed Slither findings require explicit review")


if __name__ == "__main__":
    checks = {"sizes": sizes, "gas": gas, "coverage": coverage, "slither": slither}
    if len(sys.argv) < 2 or sys.argv[1] not in checks or (len(sys.argv) != 2 and sys.argv[1] != "slither"):
        raise SystemExit("usage: check_release_gates.py sizes|gas|coverage|slither [results.json]")
    checks[sys.argv[1]]()
