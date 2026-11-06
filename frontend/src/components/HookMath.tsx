import { Card } from "@/components/ui/card";
import type { Snapshot } from "../chain/reads.ts";
import { units } from "../format.ts";
import {
  TRIGGERS,
  continuousRateBps,
  quoteDeposit,
  signedGapBps,
} from "../swap/arbitrage.ts";
import { tokenIn, tokenOut, type Preview, type SwapContext } from "../swap/swap.ts";

const bps = (v: bigint | number) => `${v.toString()} bps`;

/**
 * The swap-time half of the mechanism, step by step, for the trade being typed. The page recomputes the gap and
 * rate the way the contracts do; the hook's own previewDeposit answer sits beside each, and governs.
 */
export function HookMath({
  ctx,
  preview,
  snapshot,
  referenceE6,
  poolE6,
}: {
  ctx: SwapContext;
  preview: Preview | null;
  snapshot: Snapshot | null;
  referenceE6: bigint | null;
  poolE6: bigint | null;
}) {
  const cfg = snapshot?.config;
  if (!preview || !cfg)
    return (
      <Card className="math-card">
        <div className="math-head">
          <h2>Inside one transaction</h2>
        </div>
        <p className="math-empty">
          Enter an amount. The hook's arithmetic for that exact trade appears
          here, read from the deployed contracts before you sign.
        </p>
      </Card>
    );
  const Q = ctx.quote;
  const out = tokenOut(ctx, preview.side);
  const inTok = tokenIn(ctx, preview.side);
  const q = (v: bigint) => `${units(v, Q.decimals, 2)} ${Q.symbol}`;
  const qFine = (v: bigint) => `${units(v, Q.decimals, 4)} ${Q.symbol}`;
  const N = preview.notionalQuote;
  const large = N >= cfg.n0;
  const gap =
    referenceE6 !== null && poolE6 !== null
      ? signedGapBps(referenceE6, poolE6, preview.side)
      : null;
  const pageRate = gap === null ? null : continuousRateBps(gap, cfg);
  const hookRate = BigInt(preview.deposit.rateBps);
  const flagged = preview.deposit.flaggedNow && !preview.deposit.exempt;
  const mask = preview.deposit.triggers;
  const depositCurrency = preview.exactOutput ? inTok : out;
  const depositOut = preview.exact?.deposit ?? (flagged ? preview.depositBound : 0n);
  const fmtDep = (v: bigint) =>
    `${units(v, depositCurrency.decimals, depositCurrency.decimals > 6 ? 8 : 4)} ${depositCurrency.symbol}`;
  const net = preview.exact?.netOut ?? preview.netOut;
  return (
    <Card className="math-card">
      <div className="math-head">
        <h2>Inside one transaction</h2>
        <span className="tl">previewDeposit · block {preview.blockNumber.toString()}</span>
      </div>
      <ol className="math-steps">
        <li>
          <span className="n">01</span>
          <div>
            <p className="math-k">Notional N</p>
            <p className="math-v">{q(N)}</p>
            <p className="math-note">
              N₀ = {q(cfg.n0)} ·{" "}
              {large
                ? "a large swap: every trigger applies"
                : "below N₀: only accumulated flow can flag it"}
            </p>
          </div>
        </li>
        <li>
          <span className="n">02</span>
          <div>
            <p className="math-k">Triggers</p>
            <ul className="math-triggers" aria-label="Trigger state">
              {TRIGGERS.map((t) => {
                const on = (mask & t.bit) !== 0;
                return (
                  <li key={t.bit} className={on ? "on" : ""} title={t.detail}>
                    <i aria-hidden="true" />
                    {t.name}
                    <span className="sr">{on ? " fires" : " does not fire"}</span>
                  </li>
                );
              })}
            </ul>
            <p className="math-note">
              Gap toward Chainlink g ={" "}
              {gap === null ? "—" : `${gap > 0n ? "+" : ""}${bps(gap)}`} · drift
              needs g ≥ τ = {bps(cfg.tauBps)} · flow fills toward N_min ={" "}
              {q(cfg.nMin)}
            </p>
          </div>
        </li>
        <li>
          <span className="n">03</span>
          <div>
            <p className="math-k">Deposit rate</p>
            <p className="math-f mono">
              min(δmax, max(δ, β·g⁺)) = min({cfg.deltaMaxBps}, max({cfg.deltaBps},{" "}
              {cfg.betaX100 / 100} × {gap === null ? "g" : (gap > 0n ? gap : 0n).toString()}))
            </p>
            <p className="math-v">
              {bps(hookRate)}
              {pageRate !== null && pageRate !== hookRate && (
                <small> · page reads {bps(pageRate)}; the hook's own read governs</small>
              )}
            </p>
          </div>
        </li>
        <li className={flagged ? "is-held" : ""}>
          <span className="n">04</span>
          <div>
            <p className="math-k">Refundable deposit D</p>
            {flagged ? (
              <>
                <p className="math-f mono">
                  N × rate = {q(N)} × {hookRate.toString()} / 10,000 ={" "}
                  {qFine(quoteDeposit(N, hookRate))}
                </p>
                <p className="math-v gold">{fmtDep(depositOut)}</p>
                <p className="math-note">
                  Held as an ERC-6909 claim in the PoolManager, in the{" "}
                  {preview.exactOutput ? "input" : "output"} currency, at the
                  trade's own price. No oracle is read to size it.
                </p>
              </>
            ) : (
              <>
                <p className="math-v">None</p>
                <p className="math-note">
                  No trigger fires for this trade now; it would be{" "}
                  {qFine(preview.deposit.depositIfFlagged)} if one did. The hook
                  decides again at execution.
                </p>
              </>
            )}
          </div>
        </li>
        <li>
          <span className="n">05</span>
          <div>
            <p className="math-k">
              {preview.exactOutput ? "You pay now" : "You receive now"}
            </p>
            <p className="math-v">
              {preview.exactOutput
                ? `${units(preview.exact?.netIn ?? preview.amountIn, inTok.decimals, inTok.decimals > 6 ? 6 : 2)} ${inTok.symbol}`
                : `${units(net, out.decimals, out.decimals > 6 ? 6 : 2)} ${out.symbol}`}
            </p>
            <p className="math-note">
              {preview.exactOutput
                ? "The swap's input plus D."
                : "The swap's output minus D."}{" "}
              Settlement after {cfg.settleDelay} s measures the trade against a
              signed Pyth price; whatever is not retained comes back.
            </p>
          </div>
        </li>
      </ol>
      <p className="math-foot">
        beforeSwap snapshots the price · PoolManager executes the swap ·
        afterSwap takes D. All three are one transaction: if any step fails,
        none of it happened.
      </p>
    </Card>
  );
}
