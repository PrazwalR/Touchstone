# 0056 The arbitrage licence (M9)

Date: 2 November 2026. Status: implemented and tested locally; not deployed.

M9 builds spec §10: `LicenceAuction`, the hook's fast path, the Settler's band regime and invariants I11 to I13.
The formulas, regimes, defaults and bounds are the spec's. This record covers the implementation choices the spec
leaves open, and the places where code differs from its wording.

## Where the code differs from the spec's wording

1. **The auction settles rent into the hook's claims.**
   - Spec §10 says accrue "transfers the rent to the hook" and the hook "settles the tokens into ERC-6909 claims".
   - Here, `accrue` unlocks the PoolManager itself: it syncs, transfers the quote tokens, settles, and mints the
     claims to the hook. Only then does it call `creditRent`, which does the accounting.
   - Reason: hook size. With the settlement code in the hook it was 25,294 bytes, 718 over EIP-170.
   - Cost:
     - The auction gains a `POOL_MANAGER` immutable and an unlock callback.
     - The hook trusts its immutable auction to have minted `amount` before calling. That fits the one-way trust
       of §4, where the hook trusts only its immutables.
   - Money flow is unchanged: the same amount reaches the same claims and splits the same way.
2. **Deployment order.**
   - The spec orders deployment as Settler, auction, ledger, lens, factory, router.
   - `CoreDeployer` deploys ledger, factory, Settler, router, then the auction at nonce + 4.
   - Every address is predicted from the deployer's nonce and checked after deployment. The factory and the
     auction each name the other, which the prediction resolves.
3. **Two extra events, `RefundCredited` and `RefundClaimed`.** Displaced deposits are otherwise invisible until
   claimed.
4. **One extra error, `Touchstone__TransferShortfall`.**
   - `bid` and `topUp` check the auction's balance before and after each pull.
   - A fee-on-transfer quote token would leave deposits larger than the balance, which breaks I12.
   - So such a pull reverts.

## Implementation choices

- **One state machine.**
  - `_advance` is a pure function from the stored leases and a time to the leases at that time, the rent charged
    and what ended.
  - `leases`, `minNextRent` and the full route of `holderOf` apply it in memory; `accrue` applies it to storage.
- **Remainders.**
  - A lapse returns the deposit left below one second of rent to the owner. The lease runs out at
    `since + deposit / rent`, as `research/reference/touchstone_ref.py` `rent_due` computes it.
  - A displaced pending bid charged nothing, so its whole deposit is returned.
- **holderOf's narrow read.**
  - The swap path calls `holderOf` on every licence-pool swap at or above N0.
  - Unless a pending bid is already due, it reads one terms slot, the pending bid's first slot and the holder's
    three slots. That is five cold reads, against the spec target of six.
  - A due bid falls back to `_advance`.
  - `testFuzz_HolderOfMatchesAdvance` (2,000 runs) checks that both routes agree.
- **Checks-effects-interactions.**
  - Each mutating function advances storage, makes its own changes, and only then pulls deposits, sends
    withdrawals or hands rent to the hook.
  - A transient lock also guards every entry point.
  - Slither's `reentrancy-no-eth` findings on the first version are gone.
- **The fast path never trusts a zero address.**
  - A trusted router's `msgSender()` is zero outside its own swaps. A lease whose exempt address is zero would
    therefore match any such swap, so the hook requires a non-zero holder.
  - A router whose `msgSender()` reverts counts as the swapper itself.
- **A stale reference is not a zero gap.**
  - `_gap` returns `GAP_UNKNOWN` (the minimum int256) when the reference is absent, stale or unreadable.
  - Being negative, it adds nothing to the deposit rate and never fires drift, exactly as zero did.
  - The fast path requires a measured gap.
- **The licence answer is read as plain words.**
  - The hook decodes `holderOf`'s return as two `uint256`s, after a call and length check.
  - A malformed answer therefore reads as some address instead of reverting the swap (§4: the swap path never
    reverts on a dependency).
- **Factory.**
  - `createPool` takes `LeaseParams` (spec §13).
  - Leases are validated against §14:
    - k from 60 s to 7 days;
    - increment from 1% to 50%;
    - a non-zero reserve;
    - an ERC-20 quote token, else `Touchstone__QuoteNotErc20`;
    - an auction in the deployment, else `Touchstone__LicenceDisabled`.
  - The factory no longer rejects the `LICENCE` flag. The deploy config keeps it off until E10 passes (§14).

## Size and gas, measured 2 November 2026

| Item | Measured | Limit or target |
| --- | ---: | --- |
| TouchstoneHook runtime | 24,437 bytes | 24,576 (EIP-170) |
| LicenceAuction runtime | 15,417 bytes | 24,576 |
| Swap at or above N0, plain pool, hook-added | 47,651 (+4.96% vs pre-repair) | 5% gate |
| Licence check on a licence pool, steady state | 16,235 | 18,000 (spec §10) |
| Holder's exempt swap, hook-added | 72,442 | below a flagged swap (144,994) |

- **Swap path.**
  - Getting under the gate took three changes:
    - testing the `LICENCE` flag before anything else on the swap path;
    - the `GAP_UNKNOWN` sentinel, in place of an extra struct field;
    - one bit field for the two licence booleans.
  - The margin is 16 gas.
- **Licence check.**
  - Measured against a hooked pool without the flag, through the same router, with both pools warmed.
  - It includes about 2.1k for the test router's storage read of `msgSender`, which GuardedRouter makes from
    transient storage.
- **Hook size: 139 bytes left. M10 cannot add the URC-4 forwarders without moving `previewDeposit`'s logic
  behind the lens first.**
  - Removing that logic measured about 1,170 bytes.
  - Lowering the hook's optimizer runs saves under 150 bytes.
  - The legacy pipeline fails with stack-too-deep.

## Consequences

- **Redeployment.** The testnet contracts deployed on 1 November predate M9: the hook's immutables and the
  factory's `createPool` changed. Using the licence on Arbitrum Sepolia needs a new core deployment, hook
  included. The demo pool's config has no `pool.lease` section, so a redeployed demo pool is still not a licence
  pool.
- **Off-chain (D2):**
  - the keeper should call `accrue` every few minutes on licence pools (§12);
  - the indexer should read the auction's events;
  - bots and the dashboard licence page depend on this ABI, exported to `backend/shared/abi` and
    `frontend/abi`.
- **Research.** E10 decides whether any pool enables the licence. Nothing here changes that gate.
