# 0047 Reconcile the supplied export with implementation decisions

Date: 30 October 2026. Status: implementation/documentation clarification; no new economic parameters.

The owner selected root spec.md during the repair. It is dated 18 October and contains older interface,
layout and 18-decimal price examples, while the repository's existing decisions explicitly select named
folders, the 1e36 price scale, referenceFeed naming and staged interfaces. Those decisions remain in force.
The original export is preserved; docs/SPEC.md links to it instead of maintaining a divergent copy.

## Publish time versus submission time

The export's keeper text says that once the latest usable update time passes a record can only expire.
Its actual settlement algorithm instead bounds Pyth's update publish time in parsePriceFeedUpdatesUnique;
it checks no upper transaction-time bound. A signed update published within the window can be submitted
later while the record is open. The repaired keeper therefore continues trying timely updates until
expiry eligibility, then follows its existing expire policy. No new contract deadline is imposed.

## Reference and amount

The reference is not used for risky-token conversion, which uses execution receipts. However the deposit
rate depends on its signed gap. Thus the reference affects both flagging and deposit amounts, and indirectly
the cap on possible retention. The original claim that it never affects an amount is inaccurate. Decision0022
and ReferenceLib documentation are corrected without changing the formula.

## Explicitly acknowledged economic scope

The export acknowledges profitable LP self-wash above the liquidity-share threshold and requires E11 to kill
rebates on a pool where a strategy profits at its chosen kappa. No new eligibility rule or silent rebate
removal was authorized by the implementation audit. Concentration can change after registration, including
through JIT liquidity, so a one-time concentration check is not a permanent safety guarantee.

The stated vesting formula does not enforce a holding period. JIT/dust examples contradict the export's
security claim; the formula is preserved and its limitation disclosed pending a reward-policy decision.
Cap pass-through is also specified. Its claim that filling the cap is impractical is contradicted by the
reproduced attack; changing pass-through to rejection would require an availability decision.

## Authorized and conforming changes

0042 and0044 are explicit owner-approved deviations to payout delivery and the record surface. 0045 repairs
the stated actual-receipt rule outside overshoot. 0046 aligns unfrozen research with that behavior and prevents
draft execution. They do not retune E1/E2 or remove the remaining approximation on genuinely overshooting
tick-crossing trades. Local tests do not establish the exported event schedule, chain addresses or novelty claims.
