# Lesson 12: running the licence off-chain

## 1. Concept

The licence (lesson 10) is a lease paid by the second. Nothing on chain moves money on a timer, so rent only
reaches LPs when someone calls `accrue`: the auction computes `rent × seconds` since the last accrual, mints it
into the PoolManager as claims for the hook, and the hook splits it between the rebate pool and the vesting
buffer. Two numbers must therefore always agree over time:

- RentCharged, summed over the auction's events, is what holders paid;
- RentCredited, summed over the hook's events, is what LPs got.

Invariant I12 says they are equal once every accrual has landed. The off-chain stack exists to make that true in
practice (the keeper accrues), to show it (the indexer and dashboard), and to exercise it (the bots).

## 2. Design decisions

| Chosen | Rejected | Trade-off |
| --- | --- | --- |
| Keeper decides to accrue by simulating `accrue` | Reading `leases()` | `leases()` already shows a lapsed holder as gone, while its charged rent still waits in the auction |
| Rent totals summed as BigInt in code | SQL `SUM` | SQLite integers are 64-bit; uint256 amounts overflow |
| Holder read live from `holderOf` | Derived from events | A lapse emits nothing until the next accrual |
| Holder bot guard `maxDeposit = 0` | A small allowance | The demonstration is that the holder's swap is exempt; any deposit means it was not |
| Wiring check reads each view separately | One batch | A pre-M9 hook has no `LICENCE()`; a batch would fail as "RPC unreachable" |

## 3. Code walkthrough

- `backend/keeper/src/keeper.ts` `#housekeepAccrue`: per licensed pool, at most once per
  `KEEPER_ACCRUE_INTERVAL_S`, simulate `accrue`; send only when it would charge something.
- `backend/keeper/src/wiring.ts` `checkWiring`: chain id, code at each address, then each cross-reference.
- `backend/indexer/src/history.ts` `licenceSummary`: one ordered pass over the pool's licence events.
- `backend/bots/src/strategy.ts` `planBid`: the minimum rent, a deposit of `max(leaseSeconds, k)` seconds of it,
  and the refusals; `isDepositRefusal`: walks a viem error's causes for `Touchstone__GuardFailed(1)`.
- `frontend/src/chain/licence.ts` `licenceTimeline`: `lapsesAt = since + deposit / rent`, `activatesAt =
  next.since + k`, and whether the pending bid displaces the holder.

## 4. Failure modes

| Failure | Blast radius | Caught by |
| --- | --- | --- |
| Keeper stops accruing | Rent waits in the auction; LPs are paid late, not less | The dashboard's "not yet delivered" figure; keeper e2e witness |
| Keeper pointed at a mismatched deployment | It would settle or accrue the wrong contracts | `checkWiring` at startup; e2e "names every mismatch" |
| Indexer behind | Summary under-reports | `rentInFlight` shows the gap |
| Bidder misconfigured | Locks more quote than intended | `BOT_LEASE_MAX_DEPOSIT`, explicit allowance, simulate-only default |
| Holder not exempt in a block | Would pay a deposit | Guard reverts in simulation; the bot skips |

## 5. Audit questions

1. *Can rent be lost if no one accrues for a long time?* No. The charge is `rent × elapsed`, capped by the
   deposit, and is computed at the next accrual whenever it comes.
2. *Can the API report more rent than was paid?* Only if the database held events that were reorged out; the
   indexer rewinds below its confirmation depth, and the API reads only confirmed rows.
3. *Does the bidder ever approve tokens?* No. It checks the allowance and stops if it is short.
4. *Why simulate-only by default?* `BOT_SUBMIT=false` loads no key; submitting needs an explicit `true`, a
   keystore with mode 600, and the gas limits.
5. *Is the wiring check a security boundary?* No; it is an operator safety net. The contracts check each other
   through immutables regardless.

## 6. Exercises

1. In the keeper witness, the deposit is `1,000 × 60 × 20` and the rent 1,000 per second. Confirm the lease
   lapses 1,200 s after activation, and that the final RentCharged total equals the deposit exactly.
2. Run `pnpm -C backend preflight` and explain each line it prints.
3. With `BOT_LEASE_SECONDS=10` and a notice of 60 s, work out the deposit `planBid` chooses at a minimum rent of
   5, and confirm it against `never covers less than the notice`.

## 7. Alerts (spec 15.6)

The keeper publishes `KEEPER_METRICS_PATH` after every tick: its account, the gas it spent in the last 24 hours,
and Hermes requests and errors in a trailing window (a 404 before an update exists is not an error). The monitor
(`pnpm -C backend/indexer monitor`) combines that file, the indexer's database and the chain, and posts to Discord.
`evaluate()` in `backend/indexer/src/monitor.ts` is pure, so every rule is tested at its threshold
(`backend/indexer/test/monitor.test.ts`). `docs/runbook.md` gives each alert a scenario that fires it and a response.

Exercise: with `MONITOR_LAG_SLACK_S=30` and a pool settle delay of 3 s, work out the p95 lag that first fires the
alert, and confirm it against `fires one second past the settlement-lag line`.
