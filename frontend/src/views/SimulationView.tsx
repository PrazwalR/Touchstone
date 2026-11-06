import { useCallback, useEffect, useState } from "react";
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
  inputToReach,
  signedGapBps,
  sqrtPriceX96At,
} from "../swap/arbitrage.ts";
import { swapContext } from "../swap/context.ts";
import {
  quoteIs0,
  quoteValueOfRisky,
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
  const s = live.snapshot;
  const Q = deployment.tokens.quote;
  const R = deployment.tokens.risky;
  const poolE6 = s ? priceQuotePerRiskyE6(s.sqrtPriceX96) : null;
  // Positive: the pool is below the reference, so buying moves it toward the reference.
  const buyGap =
    ref && poolE6 !== null ? signedGapBps(ref.priceE6, poolE6, "buy") : null;
  const toward: Side = buyGap !== null && buyGap < 0n ? "sell" : "buy";
  const absGap = buyGap === null ? null : buyGap < 0n ? -buyGap : buyGap;

  const fmtAmount = (side: Side, v: bigint) =>
    side === "buy"
      ? units(v, Q.decimals, 2).replace(/,/g, "")
      : units(v, R.decimals, 6).replace(/,/g, "");

  const overN0: Preset | null =
    s && poolE6 !== null && poolE6 > 0n
      ? (() => {
          const quote = (s.config.n0 * OVER_N0_BPS) / 10_000n;
          const amount =
            toward === "buy"
              ? quote
              : (quote * 10n ** BigInt(R.decimals)) / poolE6;
          return { key: `n0-${toward}`, side: toward, amount: fmtAmount(toward, amount), notionalQuote: quote };
        })()
      : null;
  const closeGap: Preset | null =
    s && ref && absGap !== null && absGap >= MIN_GAP_BPS
      ? (() => {
          const target = sqrtPriceX96At(
            ref.priceE6,
            quoteIs0(swapContext),
            R.decimals,
            Q.decimals,
          );
          const r = inputToReach(
            s.sqrtPriceX96,
            target,
            s.liquidity,
            s.lpFee,
            quoteIs0(swapContext),
          );
          if (!r) return null;
          const notionalQuote =
            r.side === "buy"
              ? r.amountIn
              : quoteValueOfRisky(r.amountIn, s.sqrtPriceX96, quoteIs0(swapContext));
          return {
            key: `gap-${r.side}-${r.amountIn}`,
            side: r.side,
            amount: fmtAmount(r.side, r.amountIn),
            notionalQuote,
          };
        })()
      : null;
  // The first prepared trade is chosen once; the live amounts keep moving, so a later one only replaces it when
  // the presenter clicks, and an edited amount is never reset underneath them.
  // It waits for the reference: the direction comes from the gap, and defaulting to a buy before the price
  // arrives would open the card on the wrong side.
  // Closing a gap of a few basis points is a trade far below N₀, which flags nothing, so it is only the default when
  // it is large enough to be the kind of swap the hook watches.
  const initial =
    buyGap === null || !s
      ? null
      : closeGap && closeGap.notionalQuote >= s.config.n0
        ? closeGap
        : overN0;
  useEffect(() => {
    if (preset === null && initial !== null) setPreset(initial);
  }, [preset, initial]);
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
        {closeGap && (
          <button
            type="button"
            className={`chip-btn ${active?.key.startsWith("gap-") ? "on" : ""}`}
            onClick={() => setPreset(closeGap)}
          >
            Close the gap · {closeGap.amount}{" "}
            {closeGap.side === "buy" ? Q.symbol : R.symbol}
          </button>
        )}
        {overN0 && (
          <button
            type="button"
            className={`chip-btn ${active?.key.startsWith("n0-") ? "on" : ""}`}
            onClick={() => setPreset(overN0)}
          >
            Just over N₀ · {overN0.amount}{" "}
            {overN0.side === "buy" ? Q.symbol : R.symbol}
          </button>
        )}
        <span className="sim-preset-note">
          Close the gap sizes the trade from the pool's active liquidity to land
          on the Chainlink price; the quote then prices it exactly.
        </span>
      </div>
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
            key={active.key}
            ctx={swapContext}
            initialSide={active.side}
            initialAmount={active.amount}
            onSwapped={onSwapped}
            onPreview={setPreview}
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
