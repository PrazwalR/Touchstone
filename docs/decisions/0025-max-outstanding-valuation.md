# 0025 How maxOutstanding is measured

Status: decided; touches money flow only as a guard, recorded for the owners to confirm.

`maxOutstanding` is in quote units, but deposits sit in whichever currency was unspecified. The hook values the
pool's risky-side outstanding at the current swap's execution price and stops taking deposits when
outstanding quote + outstanding risky at p_exec + this deposit would exceed the cap. The comparison is written as
outRisky <= (budget remaining) x riskyAbs / notional so that no price, however extreme, can overflow and revert
the swap (0031). A deposit that would push either currency's outstanding above 2^128 is also refused.

Alternative rejected: one cap per currency, which needs two config fields and a price assumption at creation.
