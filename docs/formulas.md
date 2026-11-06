# Where the formulas come from

Measured from papers, chosen by us.

The full derivation, every variable with its units, and the code that implements each line are in `docs/formulas-research-and-current-code.md`. In short: the measurement comes from the literature, while the deposit schedule, the triggers, the allowance and the shares are Touchstone's own design choices, fixed in the spec's §4 and §14 and never claimed optimal.

## The formulas and their basis

| Formula | What it is | Basis |
| --- | --- | --- |
| `m = x_r·P* + x_q` | Trader markout: signed receipts valued at the settlement price P*. Positive means the trader got more than they paid. | Markout measurement as in Sadeghi et al. §4.1; Touchstone's horizon (3 s) and oracle (Pyth) are its own. |
| `R = min(D, α·max(0, m − (ε+c)·N))` | Retained amount. ε is a margin (2 bp), c the Pyth confidence, α the share (80%), D the deposit cap. | Touchstone policy (spec §4.3). LVR motivates measuring adverse selection; it does not derive these values. |
| `rate = min(δmax, max(δ, β·g⁺))` | Deposit rate: floor δ 30 bp, slope β 1.25 on the gap g toward Chainlink, cap δmax 300 bp. D = N × rate. | Touchstone design (spec §4.2, §14). |
| `g = s·(P_ref − p_pre)/P_ref` | Signed gap in bps between the Chainlink reference and the pre-swap pool price; positive when trading toward the reference. | Assay's signed drift, carried forward (spec §4). |
| `N ≥ N₀, bucket ≥ N_min, g ≥ τ` | Triggers: size N₀, flow bucket N_min draining over h seconds, drift threshold τ, plus first touch per block and closed market. | Calibrated on Ethereum swaps in E1, tested held out in E2. |
| `r* = (L − F) / (α·(L − (f+ε)·s))` | Break-even recall: the share of toxic flow the trigger must catch to help LPs. | Spec author's derivation (§4.5), using the Kovalenko preprint's average LP loss L ≈ 8.5 bp and fee F ≈ 6.3 bp; report average 0.451. |
| `σ²V/8` | Instantaneous LVR of a constant-product pool. | Milionis, Moallemi, Roughgarden and Zhang, arXiv 2208.06046. |
| `Licence rent ≥ r·K` | An auctioned right to trade inside a band without retention, paying rent to LPs. | Adapted from am-AMM, Adams, Moallemi, Reynolds and Robinson, arXiv 2403.03367; reimplemented, no AGPL code. |

## Every variable

Amounts in the contracts are integer token base units. Prices are quote per risky token.

| Symbol | Meaning | Value or unit |
| --- | --- | --- |
| `x_r, x_q` | The trader's risky and quote receipts from the swap, before the deposit. Receipt positive, payment negative. | Signed base units |
| `N` | Notional: the absolute quote amount of the swap, executed fee included. | Quote base units |
| `s` | Direction: +1 when buying the risky token, −1 when selling. | Sign only |
| `p_pre` | Pool price immediately before the swap. | Quote per risky |
| `P_ref` | Chainlink reference price read at swap time. | Quote per risky |
| `P*` | Pyth price used at settlement: the first signed update at or after the target time. | Quote per risky |
| `g` | Signed gap toward the reference, in basis points. | bps |
| `D` | Refundable deposit, taken in the output currency for exact input and the input currency for exact output. | Token base units |
| `R` | Amount retained from D after settlement. | Token base units |
| `m` | Markout of the trade at P*. | Quote base units |
| `c` | Pyth confidence, as a relative width in basis points. Above `maxConf` the whole deposit is refunded. | bps |
| `f` | The pool's LP fee. | 5 bp (500 pips) |
| `N₀` | Large-swap threshold. | Spec 5,000 USDC; testnet 5 USDC |
| `N_min` | Flow bucket level that fires the flow trigger. | Spec 100,000 USDC; testnet 100 USDC |
| `h` | Flow horizon: the bucket drains N_min every h seconds. | 12 s |
| `τ` | Drift threshold on g. | 5 bp |
| `δ, δmax, β` | Deposit rate floor, cap and slope on g. | 30 bp, 300 bp, 1.25 |
| `α` | Share of the excess markout retained, normal pools. | 80%; closed market 50%; licensed outsider 95%; licence holder 0% |
| `ε` | Margin below which markout is not retained. | 2 bp; closed market 50 bp |
| `maxConf, J` | Confidence above which a record refunds in full; closure price jump that refunds in full. | 25 bp; 25% |
| `settleDelay, maxLag, window` | Target delay after the swap, how late a Pyth update may be, and when an unsettled record can expire for a full refund. | 3 s, 10 s, 24 h |
| `tip, ρ, κ` | Settler tip on retained value (2%, capped), share of the rest that funds rebates (10%), rebate share of the fee on benign flow (40%). | See the settlement lesson |
| `vest` | Period over which LP income from retained deposits is released. | 30 minutes |
| `K, r` | Licence notice period and rent per second. | Spec 3,600 s; testnet 60 s |
| `L, F` | Average LP loss and fee, in the break-even formula. | ≈ 8.5 bp and ≈ 6.3 bp |
| `r*` | Break-even recall. | Report average 0.451; Ethereum held-out window −0.31 |

## Reading the table honestly

- A formula in the "Basis" column that names a paper is a measurement or a model taken from it. The retention rule, the deposit rate and every parameter above are choices; the papers motivate measuring adverse selection and do not prove these values optimal.
- On the held-out Ethereum window, r* is negative because LPs were already ahead net of fees. The trigger test passes under its pre-registered rule, and that comparison says little about whether retention helps LPs. Read the [research results](#/docs/research) for the caveat.
- The break-even recall is the spec author's own derivation. It has not been independently reviewed.
- Ex-post markout settlement has prior art in Hindsight (UHI10). Touchstone does not claim it.
