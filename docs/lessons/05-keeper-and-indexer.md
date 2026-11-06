# Lesson 05: the keeper and the indexer (M5)

## 1. Concept

Nothing off-chain is trusted (spec §15). The keeper makes settlement *fast*: it watches for deposits, waits
until the settlement time t0, fetches the first signed Pyth price at or after t0, and calls `Settler.settle`.
The contracts make settlement *correct*: Pyth rejects any update except the first one at or after t0, and the
hook rejects any payout that does not conserve the deposit. If the keeper disappears, anyone can settle, and a
record nobody settles can be refunded by someone submitting an expiry transaction. The indexer makes the system *visible*: it copies every event
into a database that the dashboard will read.

## 2. Design decisions

- One settlement per transaction, not a Multicall3 batch: the Settler pays the tip to `msg.sender`, which in a
  batch would be Multicall3 (decision 0036, open for the owners).
- The keeper persists its own state instead of backfilling from the indexer (0037), so a third party can run
  it alone.
- Every transaction is simulated first (`simulateContract`), to catch already-invalid calls. A competing transaction after simulation can still make a submitted
  transaction revert and consume gas.
- Profitability is tip against gas, both valued in USD from Pyth prices; with `settleAtLoss` the team keeper
  also settles records that retain value for LPs, as §15.1 step 4 asks.
- The indexer reads PoolManager events only for pools the factory registered, and detects a reorg below its
  confirmation depth by comparing the stored hash of the last indexed block.

## 3. Code walkthrough

`backend/keeper/src/keeper.ts`:
- `tick` (line 104): reads the head with the block-number cache off (a stale head is a stale clock), ingests,
  processes every open record, then housekeeping.
- `#ingest` (122): `DepositTaken` logs in ranges; the record is the event, so no storage reads.
- `#process` (145): drops a record whose hash is gone (someone else closed it); otherwise asks `nextAction`
  (keeper/src/schedule.ts) for wait, settle, stale or expire.
- `#window` (183): the settlement window always comes from `Settler.settleTime`, so calendar rules live in
  Solidity only.
- `#settle` (199): base and quote updates fetched separately at t0, checked against `latest`, fee from Pyth,
  simulate, decide, send, wait for the receipt.
- `#profitable` (267): `tipUsd * 1e4 >= costUsd * (1e4 + margin)`.
- `#housekeepDrip` (289) and `#housekeepPush` (314): §15.1 step 7.

`backend/keeper/src/hermes.ts` validates every response and classifies failures: 404, 429 and 5xx are retried,
anything else is an error. `keystore.ts` decrypts a Web3 Secret Storage v3 file (scrypt or pbkdf2,
aes-128-ctr, keccak MAC) so the key is never in the environment.

`backend/indexer/src/indexer.ts`: `tick` (59) reads up to head minus the confirmation depth; `#resume` (77)
rescans from the configured start on a hash mismatch; `#range` (90) reads registrations first so a pool created in the
range has its PoolManager events read too; `#write` (115) is idempotent on (chain, tx, log index) and keeps
the records table's status in step.

## 4. Failure modes

| Failure | Blast radius | Test |
| --- | --- | --- |
| Stale block number from client caching | Keeper never settles (found in M5) | `e2e.test.ts` settles at t0 + 5 s |
| Hermes lags | Settlement delayed; expiry refunds | `e2e.test.ts` retries, then expires |
| Hermes response malformed or for another feed | Keeper sends a bad update | `hermes.test.ts` |
| Wrong keystore password | Keeper will not start | `keystore.test.ts` |
| Reorg below the confirmation depth | Duplicate or stale rows | indexer `e2e.test.ts` reorg case |
| Keeper and someone else settle the same record | One wasted simulation | `#process` drops closed records; `revertName` catches `RecordClosed` |

## 5. Audit questions

1. *Can the keeper choose a favourable price?* No: Pyth's uniqueness rule on chain (T1), tested in Foundry.
2. *Where does the keeper's key live?* In an encrypted keystore; the password in a file outside the repository;
   the decrypted key only in process memory.
3. *What if the keeper settles at a loss forever?* `settleAtLoss` is the team keeper's policy; a third-party
   keeper turns it off and settles only for profit.
4. *Can the indexer double count?* Not on re-reads (primary key), and not across a reorg it detects. On a detected reorg it now rescans the configured history, with each range and cursor committed atomically.
   Full rescans are potentially expensive; previously corrupted databases need an explicit rebuild.
5. *Does the keeper handle closed-market records?* Yes in principle (it uses `settleTime`), but none exist
   until M6, so it is untested.

## 6. Exercises

1. Run `pnpm -C backend/keeper exec vitest run test/e2e.test.ts` and read the three tests against `#process`.
2. Change `KEEPER_MIN_MARGIN_BPS` so a $5 tip does not cover gas, and confirm `settleAtLoss` still settles a
   retaining record.
3. Explain why the indexer reads the factory's events before the PoolManager's in each range.

## Repair note, 30 October 2026

`latest` is an oracle publish-time limit, not a transaction submission deadline. The keeper attempts to settle
with timely updates until expiry eligibility; at expiry its existing policy submits `expire`. Profitability
now includes the Pyth update fee as well as execution gas; chain-specific L1/operator fees remain unvalidated.
Keeper state stores a canonical block anchor and discovered pool IDs for restart housekeeping. A missing legacy
anchor/registry or detected reorg forces rescan from the configured start. Both indexer and keeper validate
range anchors; a failed per-record read does not stop other records.
