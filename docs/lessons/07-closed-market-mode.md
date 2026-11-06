# Lesson 07: closed-market mode and the NYSE calendar (M6)

## 1. Concept

A tokenized stock trades on the pool around the clock, but the stock's own market does not. While New York is
closed, nobody knows the price the reopen will set. A trader with information can trade against LPs at a stale
pool price that the Monday open will correct. Closed-market mode treats that whole closure as one long settlement
delay: every swap at or above N0 posts a deposit, and that deposit is settled against the first regular-session
Pyth price after the reopen.

    t0 = nextOpen(t) + openDelay        latest = t0 + maxLagClosed        expiry = t0 + W_c
    deposit = N * δ_c                   regime: α_c, ε_c, jump guard J

Why separate closure parameters? Over a weekend, an uninformed trader's markout is mostly noise, and a one-sided
clawback keeps part of the upside of that noise. This is the "noise tax" in §9.5. A lower α_c and a wider ε_c
keep that tax near what a market maker charges overnight (about 18 bp at the §9.5 numbers). E9 decides whether
the mode is worth keeping at all.

## 2. Design decisions

| Chosen | Rejected | Why |
| --- | --- | --- |
| Holidays as constructor data, no owner | An owner who updates holidays | §0.4 forbids owners. A new year means a new calendar contract, with its date visible from the start |
| `validUntil` = last covered **open** | The last covered day | Before the last open, `nextOpen` is always answerable, so `settleTime` never reverts and I10 holds |
| Two `isOpen` checks (t and t + Δ + maxLag) | One check at t | Swaps in a session's last seconds would otherwise get a continuous record with no usable price |
| Calendar read through `staticcall` with a length check | A typed call in try/catch | A typed call decodes in the caller, so short returndata would revert the swap (audit GEN-3) |
| `PoolFlags.CALENDAR` set by the factory | Reading `cfg.calendar` on every swap | One cold storage read (~2,300 gas) on crypto pools for a feature they never use |

## 3. Code walkthrough

- `NyseCalendar.isOpen`:
  1. converts to New York local time (`CalendarMath.toNewYork`);
  2. checks that the day is a trading day (weekday, inside coverage, not a holiday, by binary search);
  3. checks the time of day against 09:30 and 16:00, or 13:00 on an early-close day.
- `NyseCalendar.nextOpen`: walks forward from the local day, at most eight days, and returns the first 09:30 open
  strictly after t. `_openAt` applies that date's daylight-saving offset; transitions happen at 02:00 on a
  Sunday, so a trading day has one offset all day.
- `TouchstoneHook._evaluate`:
  - on a calendar pool, `_closedNow` decides the record's mode;
  - closure records skip `_gap` and `_firstTouch`;
  - `TriggerLib.triggers(flowHit, large, false, closed, false)` flags every swap at or above N0, plus flow hits;
  - the rate comes from `DepositLib.rateBps(MODE_CLOSED, ...)`, which is δ_c.
- `TouchstoneHook._closedNow` returns "not known" past `calendarValidUntil`, or when either read fails. The
  swap then posts no deposit.
- `TouchstoneFactory._calendarValidUntil`: checks code, the 30-day runway and Δ + maxLag < 3.5 h, then copies the
  date.
- `Settler._settleTime`: the closure branch was already there; `_jumped` refunds closure records when
  |P*/p_exec − 1| > J.

## 4. Failure modes

| Failure | Blast radius | Test |
| --- | --- | --- |
| Holiday data wrong | Wrong mode or settlement time on that pool | `NyseCalendar.t.sol`, 753 sessions against XNYS |
| Daylight-saving offset wrong | Settles an hour off on half the year | Minute sweeps of both switch weeks; the Saturday 31 October to Monday 2 November case |
| Calendar reverts or returns short data | That pool takes no deposits; swaps continue | `test_BrokenCalendarPostsNoDepositAndNeverRevertsTheSwap` |
| Calendar data runs out | No deposits after `validUntil`; open records still settle | `test_NoDepositsAfterTheCalendarRunsOut`, `test_ValidUntilIsTheLastCoveredOpen` |
| Halt or delayed open | No update before latest: expiry with a full refund at t0 + W_c | `test_ClosureRecordExpiresOnlyAfterTheWindowFromTheReopen` |
| Split or corporate action | Jump guard refunds in full | `test_JumpGuardRefundsAClosureRecordInFull` |

## 5. Audit questions

1. *Can a trader pick the settlement price over a weekend?* No. t0 is fixed by the record's timestamp and the
   calendar, and Pyth's uniqueness rule accepts only the first update at or after t0. Confident.
2. *What if NYSE announces an unscheduled closure?* The calendar cannot know about it. The reopen update arrives
   late or never; a late update is accepted only up to t0 + maxLagClosed, otherwise the record expires with a
   full refund. Confident.
3. *Is the 2028 New Year case right?* NYSE observes no New Year's holiday in 2028, because it falls on a
   Saturday. Both NYSE's page and XNYS agree, and the boundary test covers 3 January 2028. Confident.
4. *Does a crypto pool pay for this?* +110 to +196 gas on unflagged swaps, measured: the hookData check and the
   mode field. No extra storage read, thanks to the flag. Confident.
5. *Can a creator fake a calendar?* Yes, any contract with code and a long enough `validUntil`. A pool's terms
   are only as good as its creator, which is the open registration finding (repair 0043). Not resolved here.

## 6. Exercises

1. Compute by hand the UTC time of the first open after Friday 27 November 2026, 18:30 UTC (an early-close
   day), and check `nextOpen`.
2. Explain why `test_LastSecondsOfTheSessionGoToTheReopen` uses `TUE_OCT_27_CLOSE - 10`, and find the latest
   second for which the record would still be continuous.
3. With δ_c = 300 bp, α_c = 0.5 and ε_c = 50 bp, find the reopen move above which the cap binds on a $20,000
   weekend buy.
