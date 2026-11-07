# 0058: Licence operations off-chain: history API, dashboard panel, bots and wiring checks

Status: accepted (implementation detail under §0.11.2; no mechanism change). Date: 3 November 2026.

## Context

M9 put the licence on chain. The M9 work left four off-chain items: an Anvil
witness that the hook credits what the auction charges, indexed auction history, a read-only dashboard view,
and bounded holder and bidder bots for the testnet demonstration.

## Decisions

1. **Witness on Anvil, in the existing suites.** LocalStack now also creates a licence pool with no liquidity
   (fee 3000, notice 60 s, minimum rent 1). The keeper suite bids, lets the bid activate, has the keeper
   accrue, then lets the lease lapse, and checks that the RentCharged total equals the RentCredited total and
   finally equals the whole deposit (I12, I13). The indexer suite checks that BidPlaced, LeaseActivated,
   RentCharged and RentCredited are indexed exactly once.
2. **History API.** `GET /v1/licence` lists the licence events (filters: `poolId`, `owner`). `GET
   /v1/licence/summary?poolId=` returns counts and the charged, credited and in-flight rent. Totals are summed as
   BigInt in code, never in SQL, whose integers overflow on uint256. The live holder is not derived from events:
   a lease lapses without an event until the next accrual, so readers use `holderOf`.
3. **`LicenceAuction.terms(id)`**, a view of the registered lease terms. The bidder needs the notice period to
   size a valid deposit, and the dashboard needs it to show when a pending bid activates. It is a read of
   existing storage and changes no rule.
4. **Dashboard.** A licence panel (holder, runway, pending bid, lowest next bid; rent charged, credited and in
   flight) shows "arrives with the next deployment" until the deployment file names an auction. The quote tool
   shows the URC-4 `getIndicativeQuote` beside `previewDeposit` once the deployment names a lens.
5. **Bots.** Two new modes. `bidder` claims its displaced deposits, then places the smallest valid bid
   (`minNextRent`, with a deposit covering `BOT_LEASE_SECONDS`, at least the notice), refusing to outbid itself
   or to exceed `BOT_LEASE_MAX_RENT` or `BOT_LEASE_MAX_DEPOSIT`. It never approves tokens. `holder` trades the
   reference edge only while `holderOf` names its account, with the guard's `maxDeposit` fixed at 0: if the
   exemption does not apply in that block, the guarded swap would revert, so the bot skips it. Both check that
   the auction and hook name each other before the first round.
6. **Wiring check.** The keeper refuses to start unless the configured hook, settler, factory, ledger and auction
   are one deployment on the configured chain; `pnpm preflight` runs the same read-only check. Each view is read
   separately, so a contract from an older release names the call it lacks.

## Rejected

- Deriving the current holder from events: wrong between a lapse and the next accrual.
- Auto-approving tokens in the bidder: an approval is an owner decision with its own bound.
- A holder that accepts small deposits: it would blur the demonstration of the exemption.

## Tests

`keeper/test/e2e.test.ts` (accrual witness, wiring), `indexer/test/e2e.test.ts` (auction indexing),
`indexer/test/api.test.ts` (licence API), `bots/test/strategy.test.ts` (bid planning, deposit refusal, config),
`bots/test/e2e.test.ts` (bidder and holder against Anvil, simulate-only), `frontend/test/licence.test.ts`,
`contracts/test/unit/Licence.t.sol` (`test_Terms_ReportsTheRegisteredLease`).
