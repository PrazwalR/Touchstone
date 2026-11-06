# 0064 Local Cancun receipt replay

The VANE simulator referenced in §16.1 is absent. The independent Rust runner starts from a complete Anvil snapshot taken after the contracts and pool exist. It binds the compiled hook and manager bytecode to the deployed immutable values, replays every subsequent mined call in order, and checks receipt status, gas and logs before advancing. This preserves router approvals, hook storage and liquidity between swaps. A fork dump that contains only lazily fetched state is rejected.

The reproducible two-swap check in `sim/check-anvil.sh` matched the approval, unflagged and flagged swap receipts. Their measured full-transaction gas on the local fixture was 46,127, 166,787 and 252,209 respectively. The source is the Anvil receipt matched by the revm run at each step. The last swap emitted DepositTaken. The E8 pass line applies to hook-added gas on the unflagged path. These full-transaction figures cannot be used to judge it.

The historical adapter still needs the original pool state, liquidity and ordered swaps. E3 settlement additionally needs the authenticated Pyth update for each settlement time, and the owner's undeployed contracts cannot supply E8 receipts. Keep all three comparisons separate in release reporting.
