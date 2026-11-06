import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import type { Snapshot } from "../chain/reads.ts";
import { units } from "../format.ts";
import {
  TRIGGERS,
  continuousRateBps,
  quoteDeposit,
  signedGapBps,
} from "../swap/arbitrage.ts";
import { readReference } from "../swap/reference.ts";
import { quoteValueOfRisky, shortError, tokenIn, tokenOut, type Preview, type SwapContext } from "../swap/swap.ts";

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
}: {
  ctx: SwapContext;
  preview: Preview | null;
  snapshot: Snapshot | null;
  referenceE6: bigint | null;
}) {
  const cfg = snapshot?.config;
  const key = preview ? `${ctx.hook}-${preview.blockNumber}` : "";
  const [quoteRef, setQuoteRef] = useState<{ key: string; price: bigint | null; error: string | null } | null>(null);
  const aligned = preview && snapshot && preview.blockNumber === snapshot.blockNumber && referenceE6 !== null;
  useEffect(() => {
    if (!preview || !snapshot || aligned) return;
    let cancelled = false;
    void (async () => {
      try {
        const block = await ctx.client.getBlock({ blockNumber: preview.blockNumber });
        const ref = await readReference(ctx, { ...snapshot, blockNumber: preview.blockNumber, blockTime: block.timestamp });
        if (!cancelled) setQuoteRef({ key, price: ref.priceE6, error: null });
      } catch (err) {
        if (!cancelled) setQuoteRef({ key, price: null, error: shortError(err) });
      }
    })();
    return () => { cancelled = true; };
  }, [ctx, key, aligned]);
  const reference = aligned ? referenceE6 : quoteRef?.key === key ? quoteRef.price : null;
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
  const poolE6 = quoteValueOfRisky(10n ** BigInt(ctx.risky.decimals), preview.sqrtPriceX96,
    ctx.key.currency0.toLowerCase() === ctx.quote.address.toLowerCase()) * 1_000_000n / 10n ** BigInt(ctx.quote.decimals);
  const gap = reference !== null ? signedGapBps(reference, poolE6, preview.side) : null;
  const closed = preview.deposit.mode === 1;
  const pageRate = closed ? BigInt(cfg.deltaClosedBps) : gap === null ? null : continuousRateBps(gap, cfg);
  const hookRate = BigInt(preview.deposit.rateBps);
  const flagged = preview.exact ? preview.exact.deposit > 0n : preview.deposit.flaggedNow && !preview.deposit.exempt;
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
        <span className="tl">Read-only preview · block {preview.blockNumber.toString()}</span>
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
                ? "first-touch, drift and closure rules are eligible"
                : "below N₀: only accumulated flow can flag it"}
            </p>
          </div>
        </li>
        <li>
          <span className="n">02</span>
          <div>
            <p className="math-k">Rules met in this preview</p>
            <ul className="math-triggers" aria-label="Preview trigger state">
              {TRIGGERS.map((t) => {
                const on = (mask & t.bit) !== 0;
                return (
                  <li key={t.bit} className={on ? "on" : ""} title={t.detail}>
                    <i aria-hidden="true" />
                    {t.name}
                    <span className="sr">{on ? " met in preview" : " not met in preview"}</span>
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
            {closed ? <p className="math-f mono">Closed market: rate = δclosed = {cfg.deltaClosedBps} bps</p> : <p className="math-f mono">
              min(δmax, max(δ, β·g⁺)) = min({cfg.deltaMaxBps}, max({cfg.deltaBps},{" "}
              {cfg.betaX100 / 100} × {gap === null ? "g" : (gap > 0n ? gap : 0n).toString()}))
            </p>}
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
            <p className="math-k">Estimated refundable deposit D</p>
            {flagged ? (
              <>
                <p className="math-f mono">
                  N × rate = {q(N)} × {hookRate.toString()} / 10,000 ={" "}
                  {qFine(quoteDeposit(N, hookRate))}
                </p>
                <p className="math-v gold">{fmtDep(depositOut)}</p>
                <p className="math-note">
                  Would be held as an ERC-6909 claim in the PoolManager, in the{" "}
                  {preview.exactOutput ? "input" : "output"} currency, at the
                  quoted execution price. Chainlink influences the rate; currency conversion uses the quoted swap amounts.
                </p>
              </>
            ) : (
              <>
                <p className="math-v">None</p>
                <p className="math-note">
                  {preview.deposit.exempt
                    ? "The current licence exemption avoids a deposit in this preview."
                    : mask !== 0
                      ? "Rules are met, but the preview collects no deposit because of the exemption, budget or rounding checks."
                      : "No rule is met in this preview."}{" "}
                  If collected at this rate, the quote-valued deposit would be {qFine(preview.deposit.depositIfFlagged)}.
                  Execution determines whether anything is held.
                </p>
              </>
            )}
          </div>
        </li>
        <li>
          <span className="n">05</span>
          <div>
            <p className="math-k">
              {preview.exactOutput ? "Quoted payment" : "Quoted immediate output"}
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
              Later settlement uses a qualifying signed Pyth price. Its timing
              and payout depend on the confirmed record, including market-calendar rules.
            </p>
          </div>
        </li>
      </ol>
      {!aligned && quoteRef?.key === key && quoteRef.error && <p className="demo-error">Quote-block reference comparison unavailable: {quoteRef.error}</p>}
      <p className="math-foot">
        These are estimates, not a confirmed flag or deposit. beforeSwap snapshots the price · PoolManager executes the swap ·
        afterSwap takes D. All three are one transaction: if any step fails,
        none of it happened.
      </p>
    </Card>
  );
}
