# Lesson 14: comparing licence paths before running E10

This is an implementation lesson for the draft E10 model. M11 remains open.

## Concept

A single arbitrage opportunity cannot price a lease. A winning trade changes the pool price and therefore
the next opportunity. The sequential model carries reserves forward and sums each bidder's realized profit
and the LPs' trading income. Prices at settlement and at the markout horizon determine payouts, but only
the currently observed fair price and current costs may determine entry.

Bidder value is `profit as holder − profit under the registered outsider policy`, before rent, over the same
lease term. Run both paths from the same initial reserves with identical outside observations and arrival
draws. Their pool paths can diverge because different trades become profitable. An outsider facing another
holder pays a different retention rate from a trader in an unlicensed pool, so that comparison is explicit.

## Decisions

Use pure functions without a dataset loader while E10 is draft. Use supplied arrivals rather than generating
latency distributions before the sensitivity design is registered. Charge rent across the full supplied term,
including idle-holder time, under an explicit funded-lease assumption. Keep fees and rent outside reserves.
These choices simplify the model and require disclosure; they do not reproduce the onchain auction state machine.

## Code walkthrough

- `research/simulations/licence.py:16`, `Terms`, rejects nonfinite parameters and invalid allocation ranges.
- `first_fill` at line 67 validates the entire candidate set before finding its first profitable arrival. This prevents
  an early winner from hiding a malformed later agent. Later observations only determine realized accounting.
- `research/simulations/licence_path.py:47`, `replay_path`, advances reserves once per model block, accumulates
  bidder and LP income, measures time-weighted gaps, and charges/splits rent once at the end.
- `bidder_value` at line 128 runs two explicit pre-rent policies on the same inputs. The experiment must fix the outsider
  policy before looking at outcomes.
- `licence.py:117`, `clearing_rent`, takes total-term values. Divide its result by the same term duration before passing a rate
  to `replay_path`; passing the total as a rate overcharges rent.

## Failure modes

| Failure | Effect | Regression |
| --- | --- | --- |
| Reset reserves each block | Creates repeated artificial arbitrage opportunities | `test_path_carries_reserves_and_weights_gap_by_elapsed_time` |
| Future prices select entry | Look-ahead inflates profit | `test_future_prices_change_payouts_but_never_execution_or_entry` |
| Idle holder stops paying | Overstates holder return and understates LP income | `test_idle_holder_keeps_paying_and_outsiders_can_trade` |
| Rent gets a settlement tip | Understates LP rent | `test_rent_is_paid_once_and_split_without_a_settler_tip` |
| Invalid losing agent is ignored | Sensitivity case silently uses bad inputs | `test_invalid_later_arrival_cannot_hide_behind_a_profitable_winner` |

## Audit questions

1. Does this enable the licence? No. There is no frozen E10 run or verdict.
2. Is freshness continuous-time? No. Post-race gaps are held until the next observation; within-block waiting
   time is excluded and must be disclosed.
3. Is a missing fill a win? No. No fills means an undefined win rate.
4. Are rebates and rent compounded into liquidity? No. Their absence from reserve evolution is explicit.
5. Is the outsider counterfactual uniquely specified? No. The caller must provide it and the registration
   must justify it. Comparing different policies after seeing their values would be outcome-based selection.

## Exercises

1. A funded synthetic lease lasts five seconds at two quote tokens per second. Verify ten tokens leave the
   holder. With a 5% protocol share and 10% rebate allocation, recompute the LP rent as 8.55 tokens.
2. Change only the supplied settlement prices and confirm the final reserves and fill count stay unchanged.
3. Remove the holder from a two-agent race and confirm that a profitable outsider still enters while rent
   continues to accrue.
