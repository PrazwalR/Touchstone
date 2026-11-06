# 0048 Closed-market mode and the NYSE calendar (M6)

Status: implemented 31 October 2026 as milestone M6 of the developer specification of 25 October (§9, §20.5).
Supersedes 0029. No formula, parameter or regime changes: δ_c, α_c, ε_c, J, openDelay, maxLagClosed and W_c
keep their §14 meanings, and the Settler's closure branch was already in place.

## Calendar

`src/calendar/NyseCalendar.sol` implements `IMarketCalendar` for the regular session, 09:30 to 16:00 New York time
on weekdays, with the US daylight-saving rule since 2007 (`CalendarMath`).

- **Data source.** Holidays and 13:00 early closes are constructor data, taken from NYSE's published calendar
  for 2026 to 2028 (nyse.com/markets/hours-calendars, read 29 October 2026):
  - 29 holidays and 5 early closes;
  - no New Year's holiday in 2028, which falls on a Saturday.
  - The data lives in `script/config/nyse-2026-2028.json`.
- **No owner.** The constructor checks that each list is strictly increasing, inside the covered days and on
  weekdays, and that no early close is a holiday.
- **`validUntil()`** is the opening time of the last covered session, not the end of the data. For every t before
  it, `nextOpen(t)` is fully determined by published data, so a closure record always has a settlement time and
  `settleTime` can never revert, which keeps I10. Days outside the coverage count as closed.

## Hook

On a calendar pool, a swap at t becomes a closure record if `isOpen(t)` or `isOpen(t + Δ + maxLag)` is false
(§9.2).

- **Flagging.** Every swap at or above N0 is flagged, plus the flow trigger below N0. Drift and first touch are
  not evaluated.
- **Deposit.** N · δ_c.
- **When there is no deposit at all.** The calendar is read through a `staticcall` with a length check (the
  ReferenceLib pattern). If it cannot be read, or the time is at or past `calendarValidUntil`, the swap posts no
  deposit and still executes: no trader posts a deposit that cannot be settled (§9.1).
- **Gas.** The branch is gated on `PoolFlags.CALENDAR`, which the factory sets from the calendar address in the
  flags word the swap path already reads, so crypto pools pay no extra storage read (docs/gas.md).

## Factory

A calendar must:
- have code;
- report a `validUntil` at least 30 days after creation;
- leave Δ + maxLag shorter than the shortest session, an NYSE early close of 3.5 hours (§14.5).

The factory copies `validUntil` into the config.

## Evidence

- **Differential test.** `test/differential/NyseCalendar.t.sol` checks the calendar against exchange_calendars
  4.13.2's XNYS sessions, written by `research/tools/nyse_vectors.py`. The two sources agree on all 753 sessions,
  29 holidays and 5 early closes. The test covers:
  - every session's open and close boundary;
  - minute-by-minute sweeps of both 2026 daylight-saving weeks and Thanksgiving week;
  - 2,000 fuzzed times.
- **Unit tests.** `test/unit/ClosedMarket.t.sol` covers:
  - weekend and session records;
  - the last-seconds rule;
  - the Saturday 31 October record settling at Monday 2 November's 09:30 EST open (14:30 UTC, after daylight
    saving ends);
  - updates published before the reopen being rejected;
  - the jump guard;
  - expiry counting from the reopen;
  - no deposits after `validUntil`;
  - a broken calendar;
  - the factory's calendar rules and its ownership of the flag.

## Not done here

- E9, the weekend replay that decides whether closed-market mode stays (§16.4), is D2 research and has not run.
- A deploy script for the calendar belongs to M8.

## Update, 1 November 2026: a closure record must have a settlement time

The Settler computes a closure record's t0 from the calendar's `nextOpen`. Any creator can supply a calendar, so a
calendar that reports the market closed but reverts on `nextOpen` would have let the hook take a deposit that
could never be settled or expired (I10).

When a swap would be a closure record, the hook now calls `nextOpen` first (by `staticcall`) and posts no deposit
if it fails (`test_CalendarWithoutNextOpenPostsNoDeposit`). NyseCalendar always answers before `validUntil`.

**Residual risk:** a calendar that answers at swap time and starts reverting later, for example behind an
upgradeable proxy, would still strand its closure records. A pool's calendar is creator-chosen, like its other
terms (repair decision 0043, hostile registration). Storing t0 in the Record would remove the dependency but
changes the record surface, so it is listed for the owners.
