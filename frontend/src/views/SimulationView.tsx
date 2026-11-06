import { useCallback, useEffect, useState } from "react";
import { formatUnits } from "viem";
import { deployment } from "../chain/deployment.ts";
import { priceQuotePerRiskyE6, readEvents } from "../chain/reads.ts";
import type { Live } from "../chain/useLive.ts";
import {
  DemoHeader,
  DemoDisclosure,
  SettlementPanel,
} from "../components/DemoLayout.tsx";
import { BacktestScore } from "../components/BacktestScore.tsx";
import { HookMath } from "../components/HookMath.tsx";
import { SwapPanel } from "../components/SwapPanel.tsx";
import { ago, units } from "../format.ts";
import {
  demoGapTarget,
  inputToTarget,
  signedGapBps,
  sqrtPriceX96At,
} from "../swap/arbitrage.ts";
import { swapContext } from "../swap/context.ts";
import {
  quoteIs0,
  shortError,
  type Preview,
  type Side,
  type SwapResult,
} from "../swap/swap.ts";
import type { TrackedRecord } from "../swap/useSwapFlow.ts";
import { History } from "../sections/History.tsx";
import { Licence } from "../sections/Licence.tsx";
import { Records } from "../sections/Testnet.tsx";
import { HISTORY_URL } from "../config.ts";

const feedAbi = [
  {
    type: "function",
    name: "latestRoundData",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "roundId", type: "uint80" },
      { name: "answer", type: "int256" },
      { name: "startedAt", type: "uint256" },
      { name: "updatedAt", type: "uint256" },
      { name: "answeredInRound", type: "uint80" },
    ],
  },
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint8" }],
  },
] as const;

/** Sized just over the large-swap threshold, so the trade is the kind the mechanism exists for. */
const OVER_N0_BPS = 12_000n;
/** Below this the pool already sits on the reference and there is no gap worth closing. */
const MIN_GAP_BPS = 1n;

interface Reference {
  priceE6: bigint;
  updatedAt: number;
}

function useReference(): { ref: Reference | null; error: string | null } {
  const [ref, setRef] = useState<Reference | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    const read = async () => {
      try {
        const [round, decimals] = await Promise.all([
          swapContext.client.readContract({
            address: deployment.oracles.chainlinkEthUsd,
            abi: feedAbi,
            functionName: "latestRoundData",
          }),
          swapContext.client.readContract({
            address: deployment.oracles.chainlinkEthUsd,
            abi: feedAbi,
            functionName: "decimals",
          }),
        ]);
        const answer = round[1];
        if (answer <= 0n)
          throw new Error("the reference feed returned a non-positive price");
        const priceE6 =
          decimals >= 6
            ? answer / 10n ** BigInt(decimals - 6)
            : answer * 10n ** BigInt(6 - decimals);
        if (!cancelled) {
          setRef({ priceE6, updatedAt: Number(round[3]) });
          setError(null);
        }
      } catch (err) {
        if (!cancelled) setError(shortError(err));
      }
    };
    void read();
    const i = setInterval(() => void read(), 15_000);
    return () => {
      cancelled = true;
      clearInterval(i);
    };
  }, []);
  return { ref, error };
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
  const { ref, error: refError } = useReference();
  const [tracked, setTracked] = useState<TrackedRecord | null>(null);
  const [latestError, setLatestError] = useState<string | null>(null);
  const [following, setFollowing] = useState(false);
  const [result, setResult] = useState<SwapResult | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [preset, setPreset] = useState<Preset | null>(null);
  const [selection, setSelection] = useState(0);
  const [edited, setEdited] = useState(false);
  const [busy, setBusy] = useState(false);
  const [targets, setTargets] = useState<{ key: string; close: Preset | null; setup: Preset | null; error: string | null } | null>(null);
  const choosePreset = (p: Preset) => {
    if (busy) return;
    setPreview(null);
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
    s && poolE6 !== null && poolE6 > 0n
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
        const [close, setup] = await Promise.all([
          absGap !== null && absGap >= MIN_GAP_BPS ? make("gap", ref.priceE6) : null,
          absGap !== null && absGap < BigInt(Math.max(40, s.config.tauBps * 2)) && s.config.tauBps <= 1_000
            ? make("setup", demoGapTarget(ref.priceE6, s.config.tauBps)) : null,
        ]);
        if (!cancelled) setTargets({ key: targetKey, close, setup, error: null });
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
  useEffect(() => {
    if (preset === null && overN0 !== null && buyGap !== null) setPreset(overN0);
  }, [preset, overN0, buyGap]);
  const active = preset;

  const onSwapped = useCallback((r: SwapResult) => {
    setResult(r);
    setTracked(
      r.record
        ? {
            poolId: r.record.poolId,
            recordId: r.record.id,
            fromBlock: r.receipt.blockNumber,
            timestamp: r.record.timestamp,
            deposit: r.record.deposit,
            depositIn0: r.record.depositIn0,
            outcome: { kind: "open" },
          }
        : null,
    );
  }, []);

  const followLatest = async () => {
    setLatestError(null);
    setFollowing(true);
    try {
      const events = await readEvents();
      const d = events.find((e) => e.kind === "deposit");
      if (!d || d.kind !== "deposit") {
        setLatestError(
          "No flagged swaps found on this pool. Make a trade to open the first record.",
        );
        return;
      }
      setResult(null);
      setTracked({
        poolId: deployment.pools[0].poolId,
        recordId: d.recordId,
        fromBlock: d.block,
        timestamp: d.timestamp,
        deposit: d.deposit,
        depositIn0: d.depositIn0,
        outcome: { kind: "open" },
      });
    } catch (err) {
      setLatestError(shortError(err));
    } finally {
      setFollowing(false);
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
        <p role="status">{edited
          ? "Custom trade: you changed the form. Click a preset again to restore its direction, input token and amount."
          : active ? `Prepared: ${active.side === "buy" ? `buy ${R.symbol}` : `sell ${R.symbol}`}, ${active.exactOutput ? "requesting" : "paying"} ${active.amount} ${active.side === "buy" || active.exactOutput ? Q.symbol : R.symbol}. This amount stays fixed while live presets refresh; click a preset again to update it. Execution determines the result.`
          : "Reading the pool to prepare a trade."}</p>
        {targetKey && targets?.key !== targetKey && <p>Refreshing price-target presets…</p>}
        {targets?.key === targetKey && targets.error && <p className="demo-error" role="alert">Price-target preset unavailable: {targets.error}</p>}
      </div>
      {absGap !== null && absGap > 500n && (
        <p className="demo-error" role="alert">
          The live pool is far from Chainlink. Trades may have crossed its concentrated liquidity band.
          These are real pool prices; changing the interface does not restore the pool. Review every quote before signing.
        </p>
      )}
      <div className="sim-grid">
        {active === null ? (
          <div className="swap-card demo-trade demo-loading">
            <h2>Arbitrage swap</h2>
            <p>
              {live.error
                ? "Pool data is unavailable. Check the live data panel below."
                : "Reading the pool and reference to prepare a trade…"}
            </p>
          </div>
        ) : (
          <SwapPanel
            key={selection}
            ctx={swapContext}
            initialSide={active.side}
            initialAmount={active.amount}
            initialExactOutput={active.exactOutput}
            onSwapped={onSwapped}
            onPreview={setPreview}
            onEdited={onEdited}
            onBusyChange={setBusy}
            title="Arbitrage swap"
          />
        )}
        <HookMath
          ctx={swapContext}
          preview={preview}
          snapshot={s}
          referenceE6={ref?.priceE6 ?? null}
          poolE6={poolE6}
        />
      </div>
      <div className="sim-settle">
        <SettlementPanel
          ctx={swapContext}
          tracked={tracked}
          onChange={setTracked}
          result={result}
          live={live}
          onFollow={() => void followLatest()}
          following={following}
          followError={latestError}
        />
      </div>
      <BacktestScore />
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
