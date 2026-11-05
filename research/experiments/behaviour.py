"""Guarded E5/E6 simulation runner over explicit, hashed input tapes and sensitivity configurations.

No raw tape or configuration is read under a draft. Frozen E1/E2 modules are never modified or
rerun under their old preregistration. This runner does not manufacture missing historical data.
"""

from __future__ import annotations

import argparse
import bisect
import hashlib
import json
import math
import subprocess
from dataclasses import replace
from fractions import Fraction
from itertools import pairwise
from pathlib import Path
from typing import cast

import numpy as np

from experiments.common import ANALYSIS_FILES
from simulations.evasion import Trade, Trigger, flags, recall, split
from simulations.freshness import Market, choose
from tsr.config import RESEARCH_ROOT
from tsr.store import read_rows, sha256

FILES = (
    *ANALYSIS_FILES,
    "experiments/behaviour.py",
    "experiments/prepare_behaviour.py",
    "simulations/evasion.py",
    "simulations/freshness.py",
    "tsr/store.py",
)
DAY_SECONDS = 86_400


def analysis_hash() -> str:
    h = hashlib.sha256()
    for name in FILES:
        h.update(name.encode())
        h.update((RESEARCH_ROOT / name).read_bytes())
    return h.hexdigest()


def guard(name: str, config: Path) -> Path:
    prereg = RESEARCH_ROOT / "prereg" / f"{name}.md"
    text = prereg.read_text()
    expected = f"| Analysis code hash | `{analysis_hash()}` |"
    if "Status: **frozen**" not in text or expected not in text:
        raise SystemExit(f"{name}: freeze current analysis before any simulation input access")
    relative = prereg.relative_to(RESEARCH_ROOT.parent).as_posix()
    committed = subprocess.run(["git", "show", f"HEAD:{relative}"], capture_output=True, check=False)
    if committed.returncode or committed.stdout != prereg.read_bytes():
        raise SystemExit(f"{name}: preregistration must be committed before data access")
    for filename in FILES:
        relative_code = (RESEARCH_ROOT / filename).relative_to(RESEARCH_ROOT.parent).as_posix()
        saved = subprocess.run(["git", "show", f"HEAD:{relative_code}"], capture_output=True, check=False)
        if saved.returncode or saved.stdout != (RESEARCH_ROOT / filename).read_bytes():
            raise SystemExit("analysis code must be committed before simulation data access")
    if f"| Configuration SHA-256 | `{sha256(config)}` |" not in text:
        raise SystemExit(f"{name}: configuration differs from preregistration")
    return prereg


def integer(v: object) -> int:
    if type(v) is not int:
        raise ValueError("integer required")
    return v


def number(v: object) -> float:
    if type(v) not in (int, float) or not math.isfinite(cast(float, v)):
        raise ValueError("finite number required")
    return float(cast(float, v))


def numbers(v: object) -> list[float]:
    if not isinstance(v, list) or not v:
        raise ValueError("nonempty sensitivity grid required")
    return [number(x) for x in v]


def ci(numerators: list[float], denominators: list[float], seed: int, reps: int) -> list[float]:
    if not numerators or len(numerators) != len(denominators) or reps < 1:
        raise ValueError("bootstrap needs paired nonempty daily observations")
    rng = np.random.default_rng(seed)
    values: list[float] = []
    for _ in range(reps):
        take = rng.integers(0, len(numerators), len(numerators))
        denom = sum(denominators[int(i)] for i in take)
        if denom > 0:
            values.append(sum(numerators[int(i)] for i in take) / denom)
    if not values:
        raise ValueError("bootstrap ratios undefined")
    return [float(x) for x in np.quantile(values, [0.025, 0.975])]


def e5(config: dict[str, object], tape: Path) -> dict[str, object]:
    expected = {
        "n0",
        "n_min",
        "horizon",
        "tau_bps",
        "r_star",
        "delay_seconds",
        "block_seconds",
        "padding_multipliers",
        "seed",
        "bootstrap_reps",
        "development_start",
        "heldout_start",
        "end",
    }
    if set(config) != expected:
        raise ValueError("unexpected or missing E5 configuration field")
    cfg = Trigger(*(integer(config[k]) for k in ("n0", "n_min", "horizon", "tau_bps")))
    if cfg.n0 < 2 or cfg.n_min < cfg.n0:
        raise ValueError("invalid trigger thresholds")
    r_star = number(config["r_star"])
    block_seconds = number(config["block_seconds"])
    if block_seconds <= 0:
        raise ValueError("block_seconds must be positive")
    start, held, end = (integer(config[k]) for k in ("development_start", "heldout_start", "end"))
    if not start < held < end:
        raise ValueError("windows must be ordered and nonoverlapping")
    raw: list[Trade] = []
    for row in read_rows(tape):
        if set(row) != {"timestamp", "block", "tx", "notional", "buy", "gap_bps", "toxic", "exact_output"}:
            raise ValueError("unexpected E5 tape fields")
        if not isinstance(row["tx"], str) or type(row["buy"]) is not bool or type(row["exact_output"]) is not bool:
            raise ValueError("invalid E5 tape identity/direction")
        raw.append(
            Trade(
                integer(row["timestamp"]),
                integer(row["block"]),
                row["tx"],
                integer(row["notional"]),
                row["buy"],
                integer(row["gap_bps"]),
                integer(row["toxic"]),
                row["exact_output"],
            )
        )
    flags(raw, cfg)  # Validate ordering before transforming the tape.
    scenarios: dict[str, list[Trade]] = {"unchanged": raw, "exact_output": [replace(t, exact_output=True) for t in raw]}
    for bound in (cfg.n0 - 1, cfg.n_min - 1):
        for delay in numbers(config["delay_seconds"]):
            if delay < 0 or not delay.is_integer():
                raise ValueError("delay must be nonnegative integer seconds")
            transformed: list[Trade] = []
            for t in raw:
                transformed.extend(split(t, bound, int(delay), 0) if t.toxic > 0 else [t])
            # Virtual block cadence is an explicit sensitivity assumption, not a replay of L2 ordering.
            transformed = [replace(t, block=int(t.timestamp / block_seconds)) for t in transformed]
            scenarios[f"split_{bound}_delay_{int(delay)}"] = sorted(transformed, key=lambda t: t.timestamp)
    for multiple in numbers(config["padding_multipliers"]):
        if multiple < 1:
            raise ValueError("padding multiplier must be at least one")
        ratio = Fraction(str(multiple))
        scenarios[f"padding_notional_{multiple}"] = [
            replace(t, notional=(t.notional * ratio.numerator + ratio.denominator - 1) // ratio.denominator)
            if t.toxic > 0
            else t
            for t in raw
        ]
    result: dict[str, object] = {}
    killed: list[str] = []
    for name, trades in scenarios.items():
        windows: dict[str, object] = {}
        # Run buckets over the whole transformed tape, including development warm-up.
        all_selected = flags(trades, cfg)
        for label, lo, hi in (("development", start, held), ("heldout", held, end)):
            selected_tape = [t for t in trades if lo <= t.timestamp < hi]
            selected_flags = [f for t, f in zip(trades, all_selected, strict=True) if lo <= t.timestamp < hi]
            value = recall(selected_tape, selected_flags)
            days: dict[int, tuple[float, float]] = {}
            for t, f in zip(selected_tape, selected_flags, strict=True):
                n, d = days.get(t.timestamp // DAY_SECONDS, (0.0, 0.0))
                days[t.timestamp // DAY_SECONDS] = (n + (t.toxic if f else 0), d + t.toxic)
            if label == "heldout" and name != "unchanged" and value < r_star:
                killed.append(name)
            bounds = ci(
                [v[0] for v in days.values()],
                [v[1] for v in days.values()],
                integer(config["seed"]),
                integer(config["bootstrap_reps"]),
            )
            windows[label] = {
                "recall": value,
                "recall_ci95": bounds,
                "r_star": r_star,
                "below_break_even": value < r_star,
                "records": len(selected_tape),
            }
        result[name] = {
            "windows": windows,
            "outside_window_records": sum(not start <= t.timestamp < end for t in trades),
            "outside_window_toxic": sum(t.toxic for t in trades if not start <= t.timestamp < end),
        }
    return {
        "scenarios": result,
        "verdict": "kill" if killed else "partial trigger-evasion evidence; no full E5 pass claim",
        "heldout_kills": killed,
        "caveats": [
            "Padding holds toxic weight fixed; settlement-margin profit is not identified from this tape.",
            "Exact-output changes currency accounting, which this detection-only model does not evaluate.",
            "Delayed pieces outside the registered window are excluded and counted.",
        ],
    }


def e6(config: dict[str, object], tape: Path) -> dict[str, object]:
    expected = {
        "risky_reserve",
        "quote_reserve",
        "fee_bps",
        "trade_sizes",
        "cost_bps",
        "gas_quote",
        "latency_seconds",
        "alpha_bps",
        "eps_bps",
        "deposit_bps",
        "seed",
        "bootstrap_reps",
        "development_start",
        "heldout_start",
        "end",
    }
    if set(config) != expected:
        raise ValueError("unexpected or missing E6 configuration field")
    initial = Market(*(number(config[k]) for k in ("risky_reserve", "quote_reserve", "fee_bps")))
    times: list[int] = []
    prices: list[float] = []
    for row in read_rows(tape):
        if set(row) != {"timestamp", "price"}:
            raise ValueError("E6 tape requires timestamp and price")
        times.append(integer(row["timestamp"]))
        prices.append(number(row["price"]))
    if len(times) < 2 or any(b - a != 1 for a, b in pairwise(times)) or any(p <= 0 for p in prices):
        raise ValueError("E6 needs consecutive one-second timestamps and positive prices")
    start, held, end = (integer(config[k]) for k in ("development_start", "heldout_start", "end"))
    if not start < held < end or times[0] > start or times[-1] < end:
        raise ValueError("E6 tape must cover both registered windows")
    sizes = numbers(config["trade_sizes"])
    scenarios: list[dict[str, object]] = []
    for cost in numbers(config["cost_bps"]):
        for latency in numbers(config["latency_seconds"]):
            if latency < 0:
                raise ValueError("negative latency")
            for eps in sorted(set([cost, *numbers(config["eps_bps"])])):
                markets = [initial, initial]
                records: list[tuple[int, float, float, float, float]] = []
                for i, timestamp in enumerate(times):
                    if timestamp >= end:
                        break
                    # At an arrival, the simulated agent assumes the last observed fair price persists.
                    observed = bisect.bisect_right(times, timestamp - latency) - 1
                    if observed >= 0:
                        sizes_traded: list[float] = []
                        for j in (0, 1):
                            leg = choose(
                                markets[j],
                                prices[observed],
                                sizes,
                                cost,
                                number(config["gas_quote"]),
                                0 if j == 0 else number(config["alpha_bps"]),
                                eps,
                                number(config["deposit_bps"]),
                            )
                            if leg is not None:
                                markets[j] = leg.market
                            sizes_traded.append(0.0 if leg is None else leg.notional)
                    else:
                        sizes_traded = [0.0, 0.0]
                    records.append(
                        (
                            timestamp,
                            abs(markets[0].spot - prices[i]),
                            abs(markets[1].spot - prices[i]),
                            sizes_traded[0],
                            sizes_traded[1],
                        )
                    )
                windows: dict[str, object] = {}
                for label, lo, hi in (("development", start, held), ("heldout", held, end)):
                    daily: dict[int, tuple[float, float]] = {}
                    selected = [r for r in records if lo <= r[0] < hi]
                    if not selected:
                        raise ValueError("empty E6 window")
                    for t, plain, hook, _, _ in selected:
                        h, p = daily.get(t // DAY_SECONDS, (0.0, 0.0))
                        daily[t // DAY_SECONDS] = (h + hook, p + plain)
                    plain_total, hook_total = sum(r[1] for r in selected), sum(r[2] for r in selected)
                    if plain_total <= 0:
                        raise ValueError("static freshness error is zero; relative verdict undefined")
                    ratio = hook_total / plain_total
                    windows[label] = {
                        "mean_abs_static": plain_total / len(selected),
                        "mean_abs_touchstone": hook_total / len(selected),
                        "freshness_ratio": ratio,
                        "ratio_ci95": ci(
                            [v[0] for v in daily.values()],
                            [v[1] for v in daily.values()],
                            integer(config["seed"]),
                            integer(config["bootstrap_reps"]),
                        ),
                        "kill": ratio > 1.1,
                        "static_entries": sum(r[3] > 0 for r in selected),
                        "touchstone_entries": sum(r[4] > 0 for r in selected),
                        "static_volume": sum(r[3] for r in selected),
                        "touchstone_volume": sum(r[4] for r in selected),
                    }
                scenarios.append({"cost_bps": cost, "latency_seconds": latency, "eps_bps": eps, "windows": windows})
    return {
        "scenarios": scenarios,
        "model": "discrete-grid constant-product sensitivity simulation",
        "caveats": [
            "No concentrated ticks, competing agents, flow triggers or fee compounding.",
            "All arbitrage faces configured retention; entry assumes observed fair persists.",
            "Mean freshness is sampled at tape timestamps; use a regular 1-second price tape.",
            "Simulation does not establish contract bytecode correctness or LP returns.",
        ],
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("experiment", choices=["E5", "E6"])
    parser.add_argument("--config", type=Path, required=True)
    parser.add_argument("--tape", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--input-manifest", type=Path, required=True)
    args = parser.parse_args()
    prereg = guard(args.experiment, args.config)
    if args.output.exists():
        raise SystemExit("output exists; use a new experiment version instead of overwriting")
    config: object = json.loads(args.config.read_text())
    if not isinstance(config, dict):
        raise ValueError("configuration object required")
    provenance: object = json.loads(args.input_manifest.read_text())
    if not isinstance(provenance, dict) or set(provenance) != {
        "experiment",
        "operation",
        "rows",
        "code_sha256",
        "prereg_sha256",
        "config_sha256",
        "source_sha256",
        "tape_sha256",
        "caveats",
    }:
        raise ValueError("normalization manifest is missing or malformed")
    if (
        provenance["experiment"] != args.experiment
        or provenance["code_sha256"] != analysis_hash()
        or provenance["prereg_sha256"] != sha256(prereg)
        or provenance["config_sha256"] != sha256(args.config)
        or provenance["tape_sha256"] != sha256(args.tape)
    ):
        raise ValueError("normalization provenance differs from registered code/config/tape")
    sources = provenance["source_sha256"]
    if (
        not isinstance(sources, dict)
        or not sources
        or any(
            not isinstance(k, str)
            or not isinstance(v, str)
            or len(v) != 64
            or any(c not in "0123456789abcdef" for c in v)
            for k, v in sources.items()
        )
    ):
        raise ValueError("raw source hashes missing from normalization manifest")
    result = (e5 if args.experiment == "E5" else e6)(config, args.tape)
    body = {
        "experiment": args.experiment,
        "label": "simulation",
        "code_sha256": analysis_hash(),
        "prereg_sha256": sha256(prereg),
        "input_sha256": {str(args.config): sha256(args.config), str(args.tape): sha256(args.tape)},
        "source_sha256": sources,
        "normalization_manifest_sha256": sha256(args.input_manifest),
        "configuration": config,
        **result,
    }
    encoded = json.dumps(body, indent=2, sort_keys=True, allow_nan=False) + "\n"
    with args.output.open("x") as out:
        out.write(encoded)


if __name__ == "__main__":
    main()
