import { useCallback, useEffect, useState } from "react";
import { ArrowUpRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "@/components/ui/accordion";
import { deployment, explorerTx } from "../chain/deployment.ts";
import { units, utc } from "../format.ts";
import { useRecordOutcome, type TrackedRecord } from "../swap/useSwapFlow.ts";
import type { RecordOutcome, SwapContext } from "../swap/swap.ts";
import { SettlementRail } from "./SettlementRail.tsx";

const SETTLE_DELAY_FALLBACK = 3;
function useClock(): number {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

export function RecordTracker({
  ctx,
  tracked,
  onChange,
  settleDelay,
  windowSeconds,
}: {
  ctx: SwapContext;
  tracked: TrackedRecord;
  onChange(t: TrackedRecord): void;
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
  const open = o.kind === "open";
  const refund =
    o.kind === "settled"
      ? o.payout.refund
      : o.kind === "expired"
        ? o.refund
        : null;
  const lpShare =
    o.kind === "settled" ? o.payout.toLPs : o.kind === "expired" ? 0n : null;
  const status = open
    ? now < t0
      ? "Reference pending"
      : expiry !== null && now >= expiry
        ? "Expiry available"
        : "Ready to settle"
    : o.kind === "expired"
      ? "Expired · refunded"
      : "Settled";
  const headline = open
    ? "Deposit held."
    : o.kind === "expired"
      ? "Full deposit refunded."
      : o.payout.benign && o.payout.rebate > 0n
        ? "Refunded, with a rebate."
        : o.payout.refund === tracked.deposit
          ? "Full deposit refunded."
          : "The deposit has settled.";
  return (
    <Card className={`settlement-card ${open ? "is-pending" : "is-settled"}`}>
      <div className="receipt-head">
        <h2>Settlement</h2>
        <span className={`receipt-state ${open ? "pending" : "complete"}`}>
          {status}
        </span>
      </div>
      <SettlementRail stage={open ? 1 : 3} expired={o.kind === "expired"} />
      <div className="receipt-main" aria-live="polite">
        <p className="receipt-record">Record #{tracked.recordId.toString()}</p>
        <h3>{headline}</h3>
        {open ? (
          <>
            <div className="receipt-held">
              <span>Refundable deposit</span>
              <strong>{amt(tracked.deposit)}</strong>
            </div>
            <p className="receipt-explanation">
              {now < t0
                ? `Eligible for settlement in ${t0 - now}s. The next qualifying signed Pyth price measures the trade.`
                : expiry !== null && now >= expiry
                  ? "The settlement window has ended. The record can be expired for a full refund."
                  : "Waiting for a settlement transaction with a qualifying signed Pyth price. The payout appears once confirmed."}
            </p>
          </>
        ) : (
          <>
            <div className="receipt-totals">
              <div>
                <span>Refund to trader</span>
                <strong>{amt(refund!)}</strong>
              </div>
              <div>
                <span>LP share · vested</span>
                <strong className="gold">{amt(lpShare!)}</strong>
              </div>
            </div>
            {o.kind === "settled" && o.payout.rebate > 0n && (
              <p className="receipt-rebate">
                Plus {amt(o.payout.rebate)} rebate to the trader
              </p>
            )}
            {o.kind === "settled" && (
              <SettlementMath
                ctx={ctx}
                deposit={tracked.deposit}
                outcome={o}
                amt={amt}
              />
            )}
            {o.kind === "settled" && <PayoutBar payout={o.payout} amt={amt} />}
            <a
              className="receipt-link"
              href={explorerTx(o.hash)}
              target="_blank"
              rel="noreferrer"
            >
              View {o.kind === "expired" ? "expiry" : "settlement"} transaction
              <ArrowUpRight size={16} />
            </a>
          </>
        )}
      </div>
      {error && (
        <p className="demo-error" role="alert">
          Outcome read unavailable: {error}. Showing the last confirmed state.
        </p>
      )}
      <Accordion className="receipt-details">
        <AccordionItem value="record">
          <AccordionTrigger>Record details</AccordionTrigger>
          <AccordionContent>
            <dl className="receipt-kv">
              <dt>Original deposit</dt>
              <dd>{amt(tracked.deposit)}</dd>
              <dt>Settlement eligible from</dt>
              <dd>{utc(t0)}</dd>
              <dt>Full-refund expiry</dt>
              <dd>
                {expiry === null ? "Pool window unavailable" : utc(expiry)}
              </dd>
              <dt>Deposit block</dt>
              <dd>{tracked.fromBlock.toString()}</dd>
              <dt>Network</dt>
              <dd>{deployment.name}</dd>
            </dl>
            <p className="swap-meta">
              Read from DepositTaken, Settled and Expired events. Anyone can
              settle with the first qualifying Pyth update. If the record
              remains unsettled past its window, anyone can expire it for a full
              deposit refund.
            </p>
          </AccordionContent>
        </AccordionItem>
        {o.kind === "settled" && (
          <AccordionItem value="allocation">
            <AccordionTrigger>Allocation details</AccordionTrigger>
            <AccordionContent>
              <PayoutDetails payout={o.payout} amt={amt} />
              <dl className="receipt-kv">
                <dt>Settlement markout</dt>
                <dd>{units(o.markout, 6, 2)} quote units</dd>
                <dt>Retention share α</dt>
                <dd>{o.alphaBps / 100}%</dd>
              </dl>
            </AccordionContent>
          </AccordionItem>
        )}
      </Accordion>
    </Card>
  );
}

/** The settlement half, from the Settled event: the signed price, the trade's markout and what was kept. */
function SettlementMath({
  ctx,
  deposit,
  outcome,
  amt,
}: {
  ctx: SwapContext;
  deposit: bigint;
  outcome: Extract<RecordOutcome, { kind: "settled" }>;
  amt(v: bigint): string;
}) {
  const Q = ctx.quote;
  const R = ctx.risky;
  // fairPriceX36 is quote base units per risky base unit times 1e36; shown as whole quote per whole risky.
  const fairE6 =
    (outcome.fairPriceX36 * 10n ** BigInt(R.decimals) * 1_000_000n) /
    (10n ** BigInt(Q.decimals) * 10n ** 36n);
  const retained = deposit - outcome.payout.refund;
  return (
    <div className="receipt-math">
      <p className="math-f mono">
        R = min(D, α · max(0, m − (ε + c) · N))
      </p>
      <dl className="receipt-kv">
        <dt>Signed Pyth price P*</dt>
        <dd>
          {units(fairE6, 6, 2)} {Q.symbol} per {R.symbol}
        </dd>
        <dt>Trader markout m at P*</dt>
        <dd>
          {outcome.markout > 0n ? "+" : ""}
          {units(outcome.markout, Q.decimals, 4)} {Q.symbol}
        </dd>
        <dt>Retention share α</dt>
        <dd>{outcome.alphaBps / 100}%</dd>
        <dt>Retained R = D − refund</dt>
        <dd className="gold">{amt(retained)}</dd>
      </dl>
      <p className="swap-meta">
        {retained === 0n
          ? outcome.markout <= 0n
            ? "The trade was worth no more than it paid at P*, so nothing is retained."
            : "Nothing is retained: the markout stayed inside the allowance of ε plus the price's confidence, or a confidence guard refunded in full."
          : "The markout above the allowance, times α, capped at D, is retained for LPs and the rebate pool."}
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
function parts(p: PayoutShape): [string, string, bigint][] {
  return [
    ["sw-refund", "Trader refund", p.refund],
    ["sw-rebate", "Trader rebate", p.rebate],
    ["sw-lps", "LPs · vested", p.toLPs],
    ["sw-pool", "Rebate pool", p.toRebatePool],
    ["sw-tip", "Settlement tip", p.tip],
    ["sw-proto", "Protocol", p.toProtocol],
  ];
}
function PayoutBar({
  payout,
  amt,
}: {
  payout: PayoutShape;
  amt(v: bigint): string;
}) {
  const shown = parts(payout).filter(([, , v]) => v > 0n);
  const total = shown.reduce((sum, [, , v]) => sum + v, 0n);
  return (
    <div className="receipt-allocation">
      <span>Confirmed allocation</span>
      <div
        className="bar"
        role="img"
        aria-label={shown
          .map(([, label, v]) => `${label} ${amt(v)}`)
          .join(", ")}
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
    </div>
  );
}
function PayoutDetails({
  payout,
  amt,
}: {
  payout: PayoutShape;
  amt(v: bigint): string;
}) {
  return (
    <dl className="receipt-kv">
      {parts(payout).map(([cls, label, v]) => (
        <div className="allocation-row" key={cls}>
          <dt>
            <i className={cls} />
            {label}
          </dt>
          <dd>{amt(v)}</dd>
        </div>
      ))}
    </dl>
  );
}
