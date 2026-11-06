# 0049 Merging the 28 October local work onto the 30 October repair

Date: 31 October 2026. Status: merge complete; the proposals below are **open for the owners**.

Work made locally after the initial commit (`ad76275`, 28 October 22:44 IST) was stashed and reapplied onto the
repair commits `68df049` to `2c935bc`. Both sides had fixed the ethskills audit findings independently. Where
they overlapped, the repair's committed, owner-approved design was kept, and the local alternative was removed
rather than layered on top.

## Kept from the repair (no change)

- Payout isolation through the ledger, without a push gas budget (0042).
- The executed-fee snapshot in the Record (0044).
- Actual receipts when a swap does not overshoot (0045).
- Research conformance and the pre-registration gate (0046).
- The keeper's late-settlement fix and its expiry policy (0047).
- The upstream `ReferenceLib`, `VestingLib` and `IRebateLedger`.

## Added on top

- **Closed-market mode (M6)** and `NyseCalendar`, decision 0048.
- **Constructor checks in the hook.** An unknown block source is rejected and a sequencer feed without code is
  rejected (audit ORC-2). An ArbSys probe was added and then removed on 1 November: Foundry's script simulation
  has no Arbitrum precompiles, so the probe made every deployment to Arbitrum fail in simulation. The block source
  comes from the per-chain config, and DeployCore refuses to run on a chain other than the config's.
- **hookData address-word check in `beforeSwap`.** A payload that would revert a flagged swap is rejected on
  every swap with `MalformedHookData` (audit AMM-10).
- **Factory checks.** A reference feed without code is rejected (audit GEN-3, field 34), and so are identical
  base and quote Pyth IDs (audit ORC-6).
- **`ISettler.HOOK()`** and the deployer's check that each support contract points back at the hook (audit TOK-8).
- **Fork tests on Arbitrum Sepolia.** They use the real PoolManager, Pyth 1.4.6 and Chainlink ETH/USD, with
  recorded Hermes updates. They show that the deployed Pyth accepts only the first update after t0
  (audit ORC-5, T1).
- **The keeper e2e test** "settles a record it reaches after maxLag".
- **Verified per-chain configs** for Arbitrum and Base Sepolia (`script/config/`).
- **Decisions 0040 and 0041** (Unichain Sepolia; erasable TypeScript).

## Removed in the merge because the owners had not approved them

Each item is listed with its evidence, so the owners can decide.

1. **Push gas budget (GEN-1, TOK-4).**
   - Proposal: forward at most a per-chain `PUSH_GAS` (constructor immutable) to each post-settlement ledger push.
   - Without it, a gas-burning native recipient makes a settlement cost several times its normal gas. In the
     audit PoC that was about 2.0M gas against 0.24M.
   - Trade-off: a push needing more than the budget leaves the amount in the ledger, claimable.
2. **Bounding the overshot in-the-money leg (ITM-1).**
   - Evidence: E3 code checks on the held-out window found 1,902 of 43,080 flagged swaps whose reconstructed
     leg exceeded the swap. That covered $102,089 of $289,693 toxic markout, under the then-current code;
     decision 0045 has since removed the non-overshooting part.
   - One case: a $291,744 swap reconstructed as N+ = $1.94M.
   - Proposal: scale an overshot leg down, at its own execution price, until neither amount exceeds the swap's.
   - Repair 0043 notes that arbitrary clamping does not establish correctness. The alternative is exact
     reconstruction, which needs tick data the record does not carry.
3. **Single-step risky deposit (MATH-2).**
   - Proposal: D = |x_r| · rate instead of flooring the quote deposit first.
   - The difference is at most one quote base unit's worth of risky, or 2.8% in the PoC's extreme decimals.
   - The research port matches the contract as it stands (0046).
4. **Drip clock on zero releases (MATH-1).**
   - Proposal: keep `vestLast` when nothing vests, so frequent drips cannot hold a sub-period buffer back.
   - Repair 0043 lists this as a release-schedule decision.
5. **Fee and decimals bounds (MATH-6, TOK-6).**
   - Repair 0043 found the 100%-fee case unreachable on pinned v4, so no bound was added on that basis.
   - The decimals bound is in the same class.
6. **Settle before expiring (ORC-4).**
   - Proposal: past `expiresAt`, the keeper tries settlement first, and expires only records with no usable
     update or nothing to retain, because expiry refunds the clawback.
   - The repair kept its existing expiry policy deliberately (0047).

## Research state after the merge

- **Freeze history.** The E3/E4 pre-registrations had been frozen locally on 28 October under analysis hash
  `cb29e86b…`, with two dated amendments. The repair changed the analysis files (0046), so that freeze is stale.
  E3 and E4 are drafts again until the owners freeze them in a commit, as the repair's gate requires.
- **Download under the stale freeze.** 12,100 of 44,476 Pyth timestamps were downloaded into
  `research/data/cache/pyth` under that freeze, before the repair. None of it has been read.
- **Cache naming.** The repair's cache identity changes the chunk file names. The chunks can be re-keyed after
  the freeze by checking each one against the new identity, instead of being fetched again.
- **Time.** At the measured Hermes throughput, about 15 accepted requests a minute, the remaining download takes
  about three days.
