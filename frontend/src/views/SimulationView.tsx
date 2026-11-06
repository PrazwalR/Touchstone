import { useCallback, useEffect, useRef, useState } from "react";
import { formatUnits } from "viem";
import { deployment } from "../chain/deployment.ts";
import { priceQuotePerRiskyE6, readEvents, type Snapshot } from "../chain/reads.ts";
import type { Live } from "../chain/useLive.ts";
import {
  DemoHeader,
  DemoDisclosure,
} from "../components/DemoLayout.tsx";
import { BacktestScore } from "../components/BacktestScore.tsx";
import { SimulationActivity, readActivity, rememberActivity, type ActivityEntry } from "../components/SimulationActivity.tsx";
import { SwapPanel } from "../components/SwapPanel.tsx";
import { ago, units } from "../format.ts";
import {
  demoGapTarget,
  inputToTarget,
  signedGapBps,
  sqrtPriceX96At,
} from "../swap/arbitrage.ts";
import { swapContext } from "../swap/context.ts";
import { readReference } from "../swap/reference.ts";
import {
  quoteIs0,
  shortError,
  recordFromReceipt,
  type Side,
  type SwapResult,
} from "../swap/swap.ts";
import { History } from "../sections/History.tsx";
import { Licence } from "../sections/Licence.tsx";
import { Records } from "../sections/Testnet.tsx";
import { HISTORY_URL } from "../config.ts";

/** Sized just over the quote-side threshold. */
const OVER_N0_BPS = 12_000n;
const MIN_GAP_BPS = 1n;
type Reference = Awaited<ReturnType<typeof readReference>>;

function useReference(snapshot: Snapshot | null): { ref: Reference | null; error: string | null } {
  const [state, setState] = useState<{ block: bigint; ref: Reference | null; error: string | null } | null>(null);
  useEffect(() => {
    if (!snapshot) return;
    let cancelled = false;
    void readReference(swapContext, snapshot).then(
      (ref) => { if (!cancelled) setState({ block: snapshot.blockNumber, ref, error: null }); },
      (err) => { if (!cancelled) setState({ block: snapshot.blockNumber, ref: null, error: shortError(err) }); },
    );
    return () => { cancelled = true; };
  }, [snapshot]);
  return state?.block === snapshot?.blockNumber
    ? { ref: state?.ref ?? null, error: state?.error ?? null }
    : { ref: null, error: null };
}

interface Preset {
  key: string;
  side: Side;
  amount: string;
  displayAmount: string;
  exactOutput: boolean;
  /** What the trade is worth in quote base units, to tell whether it clears the large-swap threshold. */
  notionalQuote: bigint;
}

export function SimulationView({ live }: { live: Live }) {
  const { ref, error: refError } = useReference(live.error ? null : live.snapshot);
  const [activity, setActivity] = useState(readActivity);
  const [selected, setSelected] = useState<ActivityEntry | null>(() => activity[0] ?? null);
  useEffect(() => { rememberActivity(activity); }, [activity]);
  const [latestError, setLatestError] = useState<string | null>(null);
  const [following, setFollowing] = useState(false);
  const followEpoch = useRef(0);
  useEffect(() => () => { followEpoch.current += 1; }, []);
  const [result, setResult] = useState<SwapResult | null>(null);
  const [notice, setNotice] = useState(false);
  const activityRef = useRef<HTMLElement>(null);
  useEffect(() => {
    setNotice(false);
    if (!result?.record) return;
    const timer = setTimeout(() => setNotice(true), Math.max(0, (result.record.timestamp + 3) * 1000 - Date.now()));
    return () => clearTimeout(timer);
  }, [result]);
  const [preset, setPreset] = useState<Preset | null>(null);
  const [selection, setSelection] = useState(0);
  const [edited, setEdited] = useState(false);
  const [busy, setBusy] = useState(false);
  const [targets, setTargets] = useState<{ key: string; close: Preset | null; setup: Preset | null; error: string | null } | null>(null);
  const choosePreset = (p: Preset) => {
    if (busy) return;
    setPreset(p);
    setSelection((n) => n + 1);
    setEdited(false);
  };
  const onEdited = useCallback(() => setEdited(true), []);
  const s = live.snapshot;
  const Q = deployment.tokens.quote;
  const R = deployment.tokens.risky;
  const poolE6 = s ? priceQuotePerRiskyE6(s.sqrtPriceX96) : null;
  // Positive: the pool is below the reference, so buying moves it toward the reference.
  const buyGap =
    ref && poolE6 !== null ? signedGapBps(ref.priceE6, poolE6, "buy") : null;
  const toward: Side = buyGap !== null && buyGap < 0n ? "sell" : "buy";
  const absGap = buyGap === null ? null : buyGap < 0n ? -buyGap : buyGap;

  const asPreset = (key: string, side: Side, amountIn: bigint, notionalQuote: bigint, exactOutput = false): Preset => {
    const token = exactOutput ? (side === "sell" ? Q : R) : (side === "buy" ? Q : R);
    return {
      key, side, exactOutput,
      amount: formatUnits(amountIn, token.decimals),
      displayAmount: units(amountIn, token.decimals, token.decimals > 6 ? 8 : 2),
      notionalQuote,
    };
  };
  const overN0: Preset | null =
    s && ref && !live.error && poolE6 !== null && poolE6 > 0n
      ? (() => {
          const quote = (s.config.n0 * OVER_N0_BPS) / 10_000n;
          // Specify the quote leg in either direction: pay Q to buy, request Q to sell.
          return asPreset(`n0-${toward}`, toward, quote, quote, toward === "sell");
        })()
      : null;
  const targetKey = s && ref ? `${s.blockNumber}-${ref.priceE6}` : "";
  useEffect(() => {
    if (!s || !ref || !targetKey) return;
    let cancelled = false;
    const make = async (kind: string, price: bigint) => {
      const target = sqrtPriceX96At(price, quoteIs0(swapContext), R.decimals, Q.decimals);
      const trade = await inputToTarget(swapContext, s.sqrtPriceX96, target, s.blockNumber);
      if (!trade) return null;
      // For a sell the returned quote leg is net of a possible hold, a conservative N0 test.
      return asPreset(`${kind}-${trade.side}-${trade.amountIn}`, trade.side, trade.amountIn,
        trade.side === "buy" ? trade.amountIn : trade.netOut);
    };
    void (async () => {
      try {
        const [close, setup] = await Promise.allSettled([
          absGap !== null && absGap >= MIN_GAP_BPS ? make("gap", ref.priceE6) : null,
          absGap !== null && absGap < BigInt(Math.max(40, s.config.tauBps * 2)) && s.config.tauBps <= 1_000
            ? make("setup", demoGapTarget(ref.priceE6, s.config.tauBps)) : null,
        ]);
        if (!cancelled) setTargets({
          key: targetKey,
          close: close.status === "fulfilled" ? close.value : null,
          setup: setup.status === "fulfilled" ? setup.value : null,
          error: [close, setup].filter((r) => r.status === "rejected")
            .map((r) => shortError((r as PromiseRejectedResult).reason)).join(" ") || null,
        });
      } catch (err) {
        if (!cancelled) setTargets({ key: targetKey, close: null, setup: null, error: shortError(err) });
      }
    })();
    return () => { cancelled = true; };
  }, [targetKey]);
  const closeGap = targets?.key === targetKey ? targets.close : null;
  const setupGap = targets?.key === targetKey && s && absGap !== null
    && (absGap < BigInt(s.config.tauBps) || !closeGap || closeGap.notionalQuote < s.config.n0)
    ? targets.setup : null;
  // A live refresh never rewrites a typed amount. A preset click explicitly resets the complete form,
  // even if the same preset was previously selected and then edited.
  const active = preset;

  const onSwapped = useCallback((r: SwapResult, side: Side) => {
    followEpoch.current += 1;
    setFollowing(false);
    setLatestError(null);
    setResult(r);
    const row = { hash: r.hash, side };
    setActivity((rows) => [row, ...rows.filter((v) => v.hash !== row.hash)].slice(0, 20));
    setSelected(row);
  }, []);

  const followLatest = async () => {
    const epoch = ++followEpoch.current;
    setLatestError(null);
    setFollowing(true);
    try {
      const events = await readEvents();
      if (epoch !== followEpoch.current) return;
      const d = events.find((e) => e.kind === "deposit");
      if (!d || d.kind !== "deposit") {
        setLatestError(
          "No flagged swaps found on this pool. Make a trade to open the first record.",
        );
        return;
      }
      const receipt = await swapContext.client.getTransactionReceipt({ hash: d.tx });
      const record = recordFromReceipt(swapContext, receipt);
      if (!record || record.id !== d.recordId) throw new Error("Unable to match the deposit to its receipt.");
      if (epoch !== followEpoch.current) return;
      const side = record.zeroForOne === quoteIs0(swapContext) ? "buy" : "sell";
      setResult(null);
      setSelected({ hash: d.tx, side });
    } catch (err) {
      if (epoch === followEpoch.current) setLatestError(shortError(err));
    } finally {
      if (epoch === followEpoch.current) setFollowing(false);
    }
  };

  const refAge = ref ? Date.now() - ref.updatedAt * 1000 : null;

  return (
    <section className="demo-view sim-view wrap" aria-labelledby="sim-title">
      <DemoHeader
        id="sim-title"
        title="Live settlement"
        live={live}
        next="swap"
      />
      <DemoDisclosure title="Market prices and demo presets">
      <div className="sim-market glass" aria-label="Live price comparison">
        <div>
          <span className="tl">Pool price · v4 slot0</span>
          <strong>
            {poolE6 === null ? "—" : units(poolE6, 6, 2)} <small>{Q.symbol}</small>
          </strong>
        </div>
        <div>
          <span className="tl">Chainlink ETH/USD</span>
          <strong className="cyan">
            {ref ? units(ref.priceE6, 6, 2) : "—"} <small>USD</small>
          </strong>
          <small className="sim-sub">
            {refAge === null ? "reading" : `updated ${ago(refAge)}`}
          </small>
        </div>
        <div>
          <span className="tl">Gap g toward reference</span>
          <strong className="gold">
            {absGap === null ? "—" : `${absGap.toString()} bps`}
          </strong>
          <small className="sim-sub">
            {buyGap === null
              ? "reading"
              : absGap === 0n
                ? "pool on the reference"
                : `pool ${toward === "buy" ? "below" : "above"}: ${toward === "buy" ? "buying" : "selling"} ${R.symbol} closes it`}
          </small>
        </div>
        <div>
          <span className="tl">Drift threshold τ</span>
          <strong>{s ? `${s.config.tauBps} bps` : "—"}</strong>
          <small className="sim-sub">
            N₀ {s ? `${units(s.config.n0, Q.decimals, 2)} ${Q.symbol}` : "—"}
          </small>
        </div>
      </div>
      {refError && (
        <p className="demo-error" role="alert">
          Reference unavailable: {refError}
        </p>
      )}
      {live.error && <p className="demo-error" role="alert">Live pool read unavailable: {live.error}. Price-target presets are paused.</p>}
      <div className="sim-presets" role="group" aria-label="Prepared trades">
        <span className="tl">Prepare</span>
        {setupGap && (
          <button
            type="button"
            className={`chip-btn ${!edited && active?.key === setupGap.key ? "on" : ""}`}
            disabled={busy}
            onClick={() => choosePreset(setupGap)}
          >
            1. Create demo gap · {setupGap.displayAmount} {setupGap.side === "buy" ? Q.symbol : R.symbol}
          </button>
        )}
        {closeGap && (
          <button
            type="button"
            className={`chip-btn ${!edited && active?.key === closeGap.key ? "on" : ""}`}
            disabled={busy}
            onClick={() => choosePreset(closeGap)}
          >
            Close the gap · {closeGap.side === "buy" ? "pay" : "sell"} {closeGap.displayAmount}{" "}
            {closeGap.side === "buy" ? Q.symbol : R.symbol}
          </button>
        )}
        {overN0 && (
          <button
            type="button"
            className={`chip-btn ${!edited && active?.key === overN0.key ? "on" : ""}`}
            disabled={busy}
            onClick={() => choosePreset(overN0)}
          >
            Small threshold trade · {overN0.exactOutput ? "receive" : "pay"} {overN0.displayAmount}{" "}{Q.symbol}
          </button>
        )}
      </div>
      <div className="sim-preset-help">
        <p><strong>Close the gap — price target.</strong> {toward === "buy" ? `Pay ${Q.symbol} to buy ${R.symbol}` : `Sell ${R.symbol} for ${Q.symbol}`} and move the pool toward Chainlink.
          The deployed lens sizes this across liquidity ticks; the swap card shows the quoted output separately.
          This is a real testnet swap, not a guaranteed profit or an automatic price reset.</p>
        <p><strong>Small threshold trade (just over N₀) — size target.</strong> N₀ is {s ? units(s.config.n0, Q.decimals, 2) : "—"} {Q.symbol};
          this prepares about 1.2 × N₀ ({overN0 ? units(overN0.notionalQuote, Q.decimals, 2) : "—"} {Q.symbol}).
          It does not aim to close the gap. Buying specifies the USDC payment; selling requests that USDC output and quotes the ETH payment. Both target the quote-side threshold without converting it at the spot price.</p>
        {setupGap && <p><strong>Create demo gap — optional setup.</strong> Prepare a separate swap to move the pool about {s ? Math.max(40, s.config.tauBps * 2) : 40} bps above Chainlink,
          then refresh and choose Close the gap. Both swaps incur costs and may collect deposits.</p>}
        <p role="status">{busy ? "A wallet action or submitted transaction is in progress. Preset changes are paused until its status is resolved." : edited
          ? "Custom trade: you changed the form. Click a preset again to restore its direction, input token and amount."
          : active ? `Prepared: ${active.side === "buy" ? `buy ${R.symbol}` : `sell ${R.symbol}`}, ${active.exactOutput ? "requesting" : "paying"} ${active.amount} ${active.side === "buy" || active.exactOutput ? Q.symbol : R.symbol}. This amount stays fixed while live presets refresh; click a preset again to update it. Execution determines the result.`
          : "Choose a preset to fill the swap form."}</p>
        {targetKey && targets?.key !== targetKey && <p>Refreshing price-target presets…</p>}
        {targets?.key === targetKey && targets.error && <p className="demo-error" role="alert">Some price-target presets are unavailable: {targets.error}</p>}
      </div>
      {absGap !== null && absGap > 500n && (
        <p className="demo-error" role="alert">
          The live pool is far from Chainlink. Trades may have crossed its concentrated liquidity band.
          These are real pool prices; changing the interface does not restore the pool. Review every quote before signing.
        </p>
      )}
      </DemoDisclosure>
      <div className="simulation-swap-form">
          <SwapPanel
            key={selection}
            ctx={swapContext}
            initialSide={active?.side ?? "buy"}
            initialAmount={active?.amount ?? ""}
            initialExactOutput={active?.exactOutput ?? false}
            onSwapped={onSwapped}
            progressiveReceipt
            onEdited={onEdited}
            onBusyChange={setBusy}
            title="Swap"
          />
      </div>
      {notice && result?.record && <aside className="simulation-notice" aria-label="Swap notification">
        <span role="status">Swap flagged for review · record #{result.record.id.toString()}</span>
        <button type="button" onClick={() => {
          followEpoch.current++;
          setFollowing(false);
          setLatestError(null);
          const row = activity.find((item) => item.hash === result.hash);
          if (row) setSelected(row);
          setNotice(false);
          activityRef.current?.scrollIntoView({ block: "start" });
        }}>View review</button>
        <button type="button" aria-label="Dismiss notification" onClick={() => setNotice(false)}>Dismiss</button>
      </aside>}
      <section ref={activityRef} aria-label="Trade activity">
        <h2>Trade activity</h2>
        {activity.length > 0 && <div className="sim-presets" aria-label="Recent swaps">
          {activity.map((row) => <button type="button" className={selected?.hash === row.hash ? "chip-btn on" : "chip-btn"}
            key={row.hash} onClick={() => { followEpoch.current++; setFollowing(false); setLatestError(null); setSelected(row); }}>
            {row.side === "buy" ? "Buy" : "Sell"} {R.symbol} · {row.hash.slice(0, 10)}
          </button>)}
        </div>}
        {selected ? <SimulationActivity key={selected.hash} entry={selected} confirmed={result?.hash === selected.hash ? result : null} />
          : <p className="swap-meta">Your confirmed swap and any subsequent settlement will appear here.</p>}
        <button type="button" className="chip-btn" disabled={following || busy} onClick={() => void followLatest()}>
          {following ? "Finding a record…" : "Follow latest pool record"}
        </button>
        {latestError && <p role="alert" className="demo-error">{latestError}</p>}
      </section>
      <DemoDisclosure title="Historical backtest results"><BacktestScore /></DemoDisclosure>
      <div className="demo-extras">
        <DemoDisclosure title="Why compare with Chainlink here and settle with Pyth">
          <p>
            Chainlink is the swap-time reference: the hook reads it to measure
            the gap g that drives the drift trigger and the deposit rate.
            Settlement uses a different, signed source: the first Pyth update at
            or after the target time, which anyone can submit and the contract
            verifies. A gap shown here is a price difference, not proof of a
            profitable arbitrage after impact and costs.
          </p>
          {live.error && <p className="demo-error">{live.error}</p>}
        </DemoDisclosure>
        <DemoDisclosure title="Records, credits and keeper history">
          {!HISTORY_URL && <Records live={live} />}
          <History />
        </DemoDisclosure>
        <DemoDisclosure title="Arbitrage licence">
          <Licence />
        </DemoDisclosure>
      </div>
    </section>
  );
}
