# 0062 Interface pins and protocol-share question

## D-4 · OpenZeppelin hooks

On 3 November 2026, `git ls-remote --tags https://github.com/OpenZeppelin/uniswap-hooks.git 'refs/tags/v1.3.0*'` returned only the annotated candidate tag `30e72f93501f65f23d1088f039a13aaa9047fd29` and its peeled commit `b5f10574f943911635754dd76ed6ce95858b7d93`. This is the commit in `contracts/lib/PINS.md`. No final v1.3.0 tag was available to diff.

## D-12 · URC-4

Touchstone implements the reference interface in forum topic 26156, post 1 (post ID 58527), revision 2, edited 30 June 2026 at 19:10 UTC. The UTF-8 `cooked` field returned by the forum topic JSON has SHA-256 `a2ed8468d7d08b53657126bb6a71f5992ca22cfe2f1410b71d15749ea3162ea6`. Its four function signatures, ERC-165 inheritance and two error selectors match `contracts/src/interfaces/IALFHook.sol`. [Draft](https://gov.uniswap.org/t/urc-4-active-liquidity-framework-hook-interface/26156/1)

On 16 July a participant requested that quoting allow execution followed by revert through eth_call. On 20 July a co-author agreed to drop the view restriction. The pinned reference text still declares the functions view. Touchstone's static lens satisfies that revision and remains callable through eth_call. [Proposal](https://gov.uniswap.org/t/urc-4-active-liquidity-framework-hook-interface/26156/2) · [Reply](https://gov.uniswap.org/t/urc-4-active-liquidity-framework-hook-interface/26156/3)

## D-11 · Draft for the owner to send

Touchstone distributes part of retained swap deposits and accrued auction rent to LPs by donation. For a pool with a protocol share configured, it credits the protocol recipient with ERC-6909 claims through RebateLedger before donating the LP portion. Retention applies the share after the settler tip. Rent applies the share to the accrued amount. Does this route satisfy the allowlist requirement for both revenue streams? Which recipient, share basis, and claim or reporting requirements should a pool use on each supported chain?

The relevant paths are `SettlementMath.splitRetained`, the hook's payout and rent accounting, and the ledger's claim functions. D-11 is open until the maintainers respond.
