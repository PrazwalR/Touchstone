import { useCallback, useEffect, useState } from "react";
import { deployment, explorerTx } from "../chain/deployment.ts";
import { units, utc } from "../format.ts";
import { useRecordOutcome, type TrackedRecord } from "../swap/useSwapFlow.ts";
import type { SwapContext } from "../swap/swap.ts";

const SETTLE_DELAY_FALLBACK = 3;

function useClock(): number {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const i = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(i);
  }, []);
  return now;
}

/**
 * A record from deposit to outcome: the deposit held, the countdown to t0, the wait for a settler, and the payout
 * as the Settler emitted it. Every figure is read from the chain: a testnet demonstration.
 */
export function RecordTracker({
  ctx,
  tracked,
  onChange,
  settleDelay,
  windowSeconds,
}: {
  ctx: SwapContext;
  tracked: TrackedRecord;
  onChange: (t: TrackedRecord) => void;
  settleDelay?: number;
  windowSeconds?: number;
}) {
  const stable = useCallback((t: TrackedRecord) => onChange(t), [onChange]);
  const error = useRecordOutcome(ctx, tracked, stable);
  const now = useClock();
  const t0 = tracked.timestamp + (settleDelay ?? SETTLE_DELAY_FALLBACK);
  const expiry = windowSeconds === undefined ? null : t0 + windowSeconds;
  const depTok =
    tracked.depositIn0 ===
    (ctx.key.currency0.toLowerCase() === ctx.quote.address.toLowerCase())
      ? ctx.quote
      : ctx.risky;
  const amt = (v: bigint) =>
    `${units(v, depTok.decimals, depTok.decimals > 6 ? 6 : 2)} ${depTok.symbol}`;
  const o = tracked.outcome;
  const step = o.kind !== "open" ? 4 : now < t0 ? 2 : 3;

  return (
    <div className="tracker">
      <h3 className="data-title">
        Record #{tracked.recordId.toString()} · testnet demonstration
      </h3>
      <ol className="track-steps">
        <li className={step >= 1 ? "done" : ""}>
          <b>Deposit held</b>
          <span>
            {amt(tracked.deposit)} held by the hook, in the swap's output
            currency
          </span>
        </li>
        <li className={step > 2 ? "done" : step === 2 ? "now" : ""}>
          <b>Waiting for t₀</b>
          <span>
            {now < t0
              ? `${t0 - now} s until the settlement price is fixed`
              : `t₀ passed at ${utc(t0)}`}
          </span>
        </li>
        <li className={step > 3 ? "done" : step === 3 ? "now" : ""}>
          <b>Settlement</b>
          <span>
            {o.kind === "open"
              ? `Any address may settle with the first Pyth update at or after t₀; the keeper does it automatically.${expiry ? ` Unsettled by ${utc(expiry)}, it expires and refunds in full.` : ""}`
              : o.kind === "settled"
                ? "Settled against the signed Pyth price"
                : "Expired: nobody settled in the window, so the deposit was refunded in full"}
          </span>
        </li>
        <li className={step === 4 ? "done" : ""}>
          <b>Outcome</b>
          <span>
            {o.kind === "open"
              ? "Pending"
              : o.kind === "expired"
                ? `Refunded ${amt(o.refund)}`
                : o.payout.benign
                  ? "Benign: refunded in full, plus a rebate"
                  : `Retained for LPs at α ${o.alphaBps / 100}%`}
          </span>
        </li>
      </ol>
      {o.kind === "settled" && (
        <Payout payout={o.payout} amt={amt} hash={o.hash} markout={o.markout} />
      )}
      {o.kind === "expired" && (
        <p className="src">
          <a href={explorerTx(o.hash)} target="_blank" rel="noreferrer">
            Expiry transaction
          </a>
        </p>
      )}
      {error && (
        <p className="err">Could not read the record's outcome: {error}</p>
      )}
      <p className="src">
        Read from DepositTaken, Settled and Expired on {deployment.name}. A
        testnet record says nothing about LP returns.
      </p>
    </div>
  );
}

type PayoutShape = {
  benign: boolean;
  refund: bigint;
  tip: bigint;
  toProtocol: bigint;
  toRebatePool: bigint;
  toLPs: bigint;
  rebate: bigint;
};

function Payout({
  payout: p,
  amt,
  hash,
  markout,
}: {
  payout: PayoutShape;
  amt: (v: bigint) => string;
  hash: string;
  markout: bigint;
}) {
  const total =
    p.refund + p.tip + p.toProtocol + p.toRebatePool + p.toLPs + p.rebate;
  const parts: [string, string, bigint][] = [
    ["sw-refund", "Refunded to the trader", p.refund],
    ["sw-rebate", "Rebate to the trader", p.rebate],
    ["sw-lps", "To LPs, vested", p.toLPs],
    ["sw-pool", "To the rebate pool", p.toRebatePool],
    ["sw-tip", "Settler's tip", p.tip],
    ["sw-proto", "Protocol", p.toProtocol],
  ];
  const shown = parts.filter(([, , v]) => v > 0n);
  return (
    <div className="payout">
      <div
        className="bar"
        role="img"
        aria-label={shown.map(([, l, v]) => `${l} ${amt(v)}`).join(", ")}
      >
        {shown.map(([cls, , v]) => (
          <span
            key={cls}
            className={`seg-b ${cls}`}
            style={{
              width: `${total === 0n ? 0 : Number((v * 10_000n) / total) / 100}%`,
            }}
          />
        ))}
      </div>
      <ul className="legend">
        {shown.map(([cls, label, v]) => (
          <li key={cls}>
            <i className={cls} />
            {label}: <span className="mono">{amt(v)}</span>
          </li>
        ))}
      </ul>
      <p className="src">
        Markout at the settlement price:{" "}
        <span className="mono">{units(markout, 6, 2)}</span> quote units ·{" "}
        <a href={explorerTx(hash)} target="_blank" rel="noreferrer">
          settlement transaction
        </a>
      </p>
    </div>
  );
}
