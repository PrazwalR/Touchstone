"""Writes the NYSE calendar inputs and the differential vectors for NyseCalendar.

Two independent sources, compared here and again by the Foundry test:
- the constructor data (holidays and 13:00 early closes) comes from NYSE's published calendar
  (nyse.com/markets/hours-calendars, read 29 October 2026) and is typed in below;
- the vectors (every regular session's open and close in UTC) come from exchange_calendars' XNYS calendar.

Usage: uv run python tools/nyse_vectors.py <contracts dir>
"""

from __future__ import annotations

import datetime as dt
import json
import sys
from pathlib import Path

import exchange_calendars as xc  # type: ignore[import-untyped]  # no stubs; used only to write test vectors

FIRST_YEAR = 2026
LAST_YEAR = 2028

# NYSE's published holidays and early closes for 2026 to 2028. New Year's Day 2028 falls on a Saturday and is
# not observed.
NYSE_HOLIDAYS = (
    "2026-01-01",
    "2026-01-19",
    "2026-02-16",
    "2026-04-03",
    "2026-05-25",
    "2026-06-19",
    "2026-07-03",
    "2026-09-07",
    "2026-11-26",
    "2026-12-25",
    "2027-01-01",
    "2027-01-18",
    "2027-02-15",
    "2027-03-26",
    "2027-05-31",
    "2027-06-18",
    "2027-07-05",
    "2027-09-06",
    "2027-11-25",
    "2027-12-24",
    "2028-01-17",
    "2028-02-21",
    "2028-04-14",
    "2028-05-29",
    "2028-06-19",
    "2028-07-04",
    "2028-09-04",
    "2028-11-23",
    "2028-12-25",
)
NYSE_EARLY_CLOSES = ("2026-11-27", "2026-12-24", "2027-11-26", "2028-07-03", "2028-11-24")

EPOCH = dt.date(1970, 1, 1)


def day_number(iso: str) -> int:
    return (dt.date.fromisoformat(iso) - EPOCH).days


def sessions() -> list[tuple[int, int]]:
    cal = xc.get_calendar("XNYS", start=f"{FIRST_YEAR}-01-01", end=f"{LAST_YEAR}-12-31")
    out: list[tuple[int, int]] = []
    for _, row in cal.schedule.iterrows():
        out.append((int(row["open"].timestamp()), int(row["close"].timestamp())))
    return out


def main() -> int:
    contracts = Path(sys.argv[1])
    data = {
        "source": "nyse.com/markets/hours-calendars, read 29 October 2026",
        "firstDay": day_number(f"{FIRST_YEAR}-01-01"),
        "lastDay": day_number(f"{LAST_YEAR}-12-31"),
        "holidays": [day_number(d) for d in NYSE_HOLIDAYS],
        "earlyCloses": [day_number(d) for d in NYSE_EARLY_CLOSES],
    }
    (contracts / "script" / "config" / "nyse-2026-2028.json").write_text(json.dumps(data, indent=1) + "\n")
    s = sessions()
    vectors = {
        "source": f"exchange_calendars {xc.__version__} XNYS, {FIRST_YEAR} to {LAST_YEAR}",
        "opens": [o for o, _ in s],
        "closes": [c for _, c in s],
    }
    out = contracts / "test" / "fixtures" / "nyse_sessions_2026_2028.json"
    out.write_text(json.dumps(vectors) + "\n")
    print(f"{len(s)} sessions, {len(NYSE_HOLIDAYS)} holidays, {len(NYSE_EARLY_CLOSES)} early closes -> {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
