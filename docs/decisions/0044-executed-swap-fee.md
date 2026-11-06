# 0044 Snapshot the executed directional swap fee

Status: approved by the owners in chat, 30 October 2026; implemented.

## Defect

The pinned v4 PoolManager computes the effective swap fee from the LP fee and the direction's protocol fee:
`protocolFee + lpFee - floor(protocolFee * lpFee / 1_000_000)`. The Settler reconstructed the in-the-money leg
with `PoolKey.fee` alone. This understated the trader's input whenever PoolManager protocol fees were enabled.
A measured local regression bought 2 ETH at a $3,005 settlement price, lost 2.621274 USDC against that price,
and nevertheless paid a 1.754427 USDC clawback before this repair.

## Decision

Read protocol and LP fees from the existing pre-swap slot0 read, select the protocol fee by `zeroForOne`, and
combine them using the pinned `ProtocolFeeLibrary.calculateSwapFee`. Carry that value through a per-pool
transient slot and append `uint24 swapFeePips` to the authenticated Record. The Settler uses this historical
fee when reconstructing the in-the-money input; later protocol-fee changes cannot reprice an existing record.
The hook returns no LP fee override and factory pools remain static-fee only.

The record tuple, its hash and the `DepositTaken` event ABI grow by one field. Backend ABIs, decoding and state
validation must be updated together. The repository documents no deployment before M8; no historical ABI migration or invented fee fallback
is implemented. External deployment state has not been independently verified. Existing
Python E1/E2 frozen code, preregistrations, vectors and recorded results are not modified.

## Validation

`contracts/test/unit/ProtocolFeeSettlement.t.sol` covers the losing-trader regression, asymmetric directional
protocol fees across all four swap cases, and protocol fees both added and removed after the swap. This does
not resolve the separate constant-liquidity approximation across initialized ticks.
