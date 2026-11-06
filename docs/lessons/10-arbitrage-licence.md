# Lesson 10: the arbitrage licence (M9)

## 1. Concept

The clawback (lessons 03 and 06) punishes arbitrage after the fact. It leaks in three places:
- **The margin:** arbitrageurs keep ε·N on every swap.
- **The cap:** nothing above the deposit is retained.
- **Overhead:** every flagged arbitrage pays for a record, a settlement and a tip.

The licence sells the right to arbitrage in advance instead. One address per pool rents an exemption: its first
large swap in each block posts no deposit, while the pool price is within G of the reference. It pays rent per
second, and the rent goes to the pool's LPs.

    holder's first swap at or above N0 in a block, |g| <= G, fresh reference  ->  no deposit
    settlement, live lease, |p_pre - P*| <= G * P*:   holder -> alpha 0,   anyone else -> alpha_lic (95%)
    settlement, no live lease or outside the band:    alpha (80%), as before
    rent charged = rent * seconds active, from a deposit of at least rent * K

**Why exclusivity is enforced at settlement, not by ordering.** On a first-come-first-served chain such as
Arbitrum, nobody can sell "go first". So an outsider may still win the race to a stale price. Inside the band,
though, it keeps only 1 − α_lic of its excess above the margin, so its win mostly pays LPs. The holder's edge is
not speed; it is that its winnings are not taxed. Competing bidders therefore bid rent up towards the value of
that edge, net of their costs, and that is what LPs earn.

**Why the band.** It does two jobs:
1. **Freshness:** an idle holder can let the price drift only about G before outsiders are paid at the full α to
   realign it.
2. **Tail protection:** jumps beyond G go back to the clawback for everyone, so a lone bidder at the reserve
   cannot buy the largest arbitrages cheaply.

**Why the notice period K.** Nobody can take the licence just for one scheduled event (CPI, earnings, the reopen),
and the holder always gets K seconds of warning before it is displaced.

## 2. Design decisions

| Chosen | Rejected | Why |
| --- | --- | --- |
| One pure `_advance` for all transitions | Separate view and write logic | Two copies of a state machine drift; the views and `accrue` must agree |
| `holderOf` reads only what its answer needs, with a full-route fallback | Always run `_advance` | It runs on every licence-pool swap; 8 cold reads became 5 (spec target: 6). A fuzz test checks both routes agree |
| The auction mints rent to the hook as claims | The hook settles the tokens (spec wording) | The hook was 718 bytes over EIP-170; money flow is identical (decision 0056) |
| `GAP_UNKNOWN` sentinel for a stale reference | An extra `fresh` field in `SwapView` | Saves gas on every swap. Being negative, it acts as a zero gap for the rate and drift |
| Holder must be non-zero | Trust the stored swapper | A trusted router reports zero outside its own swaps; a zero swapper would match them |
| Checks-effects-interactions in every auction function | Rely on the transient lock alone | Defence in depth; Slither flagged the first version |
| Remainder below one second of rent returned at lapse | Keep it as rent | Matches the research reference's `rent_due` exactly |

## 3. Code walkthrough

**`LicenceAuction` (`contracts/src/LicenceAuction.sol`):**
- `register` (82): factory only. Derives the quote currency from the factory's config and rejects a native quote.
- `bid` (94):
  1. advances storage;
  2. checks `rent >= minNextRent` and `deposit >= rent * k`;
  3. returns a displaced pending bid's deposit in full;
  4. stores the new pending bid with `since = now`, which starts its own notice;
  5. pulls the deposit (exact amount, I12), then sends rent.
- `topUp` (112), `withdraw` (123), `setSwapper` (136): owner only.
  - `withdraw` must leave `rent * k` in the deposit.
  - All three advance storage first and send rent last.
- `accrue` (145): advance, then `_sendRent` (216): unlock the PoolManager, then call `creditRent`.
- `unlockCallback` (226): PoolManager only. Sync, transfer, settle, mint claims to the hook.
- `holderOf` (165):
  - narrow read when no pending bid is due;
  - otherwise the full `_advance`;
  - a lapse is `since + deposit / rent <= now`.
- `_advance` (250), the state machine in time order:
  1. holder lapses before the pending bid's activation;
  2. activation, where the old holder pays up to that instant and the rest is returned;
  3. a just-activated holder that also lapses before now;
  4. the remaining holder pays up to now.
- `_charge` (283): rent × elapsed. It never passes the lapse time, so it never exceeds the deposit (I13).
- `_minNextRent` (300): `max(minRent, ceil(max(top, next) * (1 + increment)))`, as the reference computes it.

**`TouchstoneHook` (`contracts/src/TouchstoneHook.sol`):**
- Fast path in `_evaluate` (387–394):
  - only with the `LICENCE` flag, a large swap, and not a closure;
  - on exemption, uses up the block's first touch (I11), emits `LicensedSwap`, and returns no deposit.
- `_licence` (425):
  - static call to `holderOf`, decoded as words;
  - `byHolder` means the swapper is the holder, the holder is non-zero, and this is the block's first touch;
  - exempt when, in addition, the gap was measured and `|g| <= G`;
  - records `LICENCE_LIVE` and `BY_HOLDER` for the record.
- `_swapper` (446): a trusted router's reported trader, else the caller. It never reads hookData or tx.origin.
- `creditRent` (183) and `_creditRent` (748):
  - the drip effects run first, so new rent starts vesting now;
  - then the protocol share goes to the ledger, ρ to the rebate pool, and the rest to vesting.
  - The three parts sum to the amount, which keeps I1 intact.
- `previewDeposit` (274): `exempt` for the given swapper, through the same `_licence`.

**`Settler`:**
- `_inBand` (183): `ceil(|p_pre − P*| · 10⁴ / P*) <= G`, on the record's pre-swap price.
- It feeds `SettlementMath.alphaBps` only when the record says a lease was live (150).

**`TouchstoneFactory`:** `_validateLease` (231) checks §14's bounds; `createPool` registers the pool with the
auction (154).

## 4. Failure modes

| Failure | Blast radius | Test |
| --- | --- | --- |
| Two exempt swaps in a block | Holder escapes the clawback twice | `test_FastPath_OnlyOncePerBlock`, invariant I11 |
| A stale reference treated as in-band | Holder exempt outside the band | `test_FastPath_StaleReferencePostsADeposit` |
| A zero swapper matches router swaps | Anyone exempt through a trusted router | `test_FastPath_ZeroSwapperNeverMatches` |
| Rent charged beyond time active | Holder overcharged | `test_Lapse_MatchesTheReference`, invariant I13 |
| Auction balance short of deposits and refunds | Refunds cannot be paid | `test_Bid_DisplacedPendingBidIsRefundedInFull`, invariant I12 |
| `holderOf`'s narrow read disagrees with the state machine | Wrong exemption | `testFuzz_HolderOfMatchesAdvance` |
| Rent breaks the hook's claim accounting | I1 fails; payouts revert | `test_Rent_ReachesTheHookAsVestingAndRebatePool`, `invariant_I1_HookClaimsWithRent` |
| Wrong α at settlement | LPs over- or under-paid | `test_Settlement_*`, `test_SlowPath_HolderRefundedInFullWhenPStarIsInTheBand` |
| A licence read reverts | Swaps blocked | The read is a static call decoded as words; failure means no lease |
| Hook over the size limit | Undeployable | `scripts/check_release_gates.py sizes` |

## 5. Audit questions

1. *Can an outsider get exempted by naming the holder in hookData?* No. `_swapper` never reads hookData or
   tx.origin, only a trusted router's `msgSender()` or the direct caller. Confident.
2. *Can the holder sandwich a victim with its exemption?* The back-run is never the block's first touch, so it is
   not exempt, and inside the band it settles at α_lic. A colluding front-run at or above N0 takes the first touch
   itself. Confident about the code; the economics are E10's to measure.
3. *Can a bidder grab the licence just before a known event?* Not without K seconds of notice; the current
   holder keeps the exemption until then. Confident.
4. *What if the auction is called inside someone else's PoolManager unlock?* `accrue` unlocks the PoolManager,
   which reverts if it is already unlocked, so the auction call reverts. Nothing is stranded. Fairly confident;
   there is no test with a hostile unlocker yet.
5. *Is the 139-byte hook margin safe for M10?* No. The lens split must come first. Confident.

## 6. Exercises

1. Recompute the lapse of a lease bid at 10 per second with a deposit of 36,000 at t = 0, read at t = 4,000.
   Confirm 36,000 charged and a lapse at 3,600 against `test_Lapse_MatchesTheReference`.
2. Compute `minNextRent` after a holder at 1,001 with a 10% increment, rounding up. Confirm 1,102 against
   `test_Bid_MinimumIncrementMatchesTheReference`.
3. A record has a pre-swap price of 3,000 and P* = 3,006. Show it is inside G = 25 bps, and say which α applies to
   the holder and which to an outsider. Then check `test_Settlement_OutsiderInTheBandUsesAlphaLicensed`.
