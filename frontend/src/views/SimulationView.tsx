import { useCallback, useEffect, useState } from "react";
import { deployment } from "../chain/deployment.ts";
import { priceQuotePerRiskyE6, readEvents } from "../chain/reads.ts";
import type { Live } from "../chain/useLive.ts";
import {
  DemoHeader,
  DemoDisclosure,
  SettlementPanel,
} from "../components/DemoLayout.tsx";
import { ArrowRight } from "lucide-react";
import { SwapPanel } from "../components/SwapPanel.tsx";
import { units } from "../format.ts";
import { swapContext } from "../swap/context.ts";
import { shortError, type SwapResult } from "../swap/swap.ts";
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

export function SimulationView({ live }: { live: Live }) {
  const { ref, error: refError } = useReference();
  const [tracked, setTracked] = useState<TrackedRecord | null>(null);
  const [latestError, setLatestError] = useState<string | null>(null);
  const [following, setFollowing] = useState(false);
  const [result, setResult] = useState<SwapResult | null>(null);
  const s = live.snapshot;
  const poolE6 = s ? priceQuotePerRiskyE6(s.sqrtPriceX96) : null;
  const gapBps =
    ref && poolE6 && poolE6 > 0n
      ? Number(((ref.priceE6 - poolE6) * 10_000n) / poolE6)
      : null;
  // The arbitrage trade moves the pool toward the reference: buy when the pool is cheap, sell when it is dear.
  const side = gapBps !== null && gapBps < 0 ? "sell" : "buy";
  const Q = deployment.tokens.quote;
  const R = deployment.tokens.risky;
  const n0 = s?.config.n0 ?? null;
  const presetQuote = n0 === null ? null : (n0 * OVER_N0_BPS) / 10_000n;
  const preset =
    presetQuote === null || poolE6 === null
      ? null
      : side === "buy"
        ? units(presetQuote, Q.decimals, 2).replace(/,/g, "")
        : units(
            (presetQuote * 10n ** BigInt(R.decimals)) / poolE6,
            R.decimals,
            6,
          ).replace(/,/g, "");

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

  return (
    <section className="demo-view wrap" aria-labelledby="sim-title">
      <DemoHeader
        id="sim-title"
        title="Live settlement"
        live={live}
        next="swap"
      />
      <div className="demo-grid">
        {preset === null || gapBps === null ? (
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
            ctx={swapContext}
            initialSide={side}
            initialAmount={preset}
            onSwapped={onSwapped}
            title="Arbitrage swap"
          />
        )}
        <div className="demo-context">
          <div className="demo-market" aria-label="Live price comparison">
            <div>
              <span>Pool price</span>
              <strong>
                {poolE6 === null ? "—" : units(poolE6, 6, 2)}{" "}
                <small>{Q.symbol}</small>
              </strong>
            </div>
            <ArrowRight className="market-arrow" size={20} aria-hidden="true" />
            <div>
              <span>Chainlink reference</span>
              <strong>
                {ref ? units(ref.priceE6, 6, 2) : "—"} <small>{Q.symbol}</small>
              </strong>
            </div>
            <div className="market-gap">
              <span>Reference vs pool</span>
              <strong>
                {gapBps === null
                  ? "—"
                  : `${gapBps > 0 ? "+" : ""}${(gapBps / 100).toFixed(2)}%`}
              </strong>
            </div>
          </div>
          {refError && (
            <p className="demo-error" role="alert">
              Reference unavailable: {refError}
            </p>
          )}
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
      </div>
      <div className="demo-extras">
        <DemoDisclosure title="Chainlink price difference">
          <p>
            {gapBps === null
              ? "Reading prices."
              : `${side === "buy" ? "Buy" : "Sell"} ${R.symbol} to move the pool toward the reference.`}{" "}
            This demonstration compares the pool price with Chainlink and
            prepares a trade toward that reference. Edit the amount freely;
            your wallet signs real testnet transactions.
          </p>
          <div className="kv">
            <div>Drift threshold τ</div>
            <div className="v">{s ? `${s.config.tauBps} bps` : "—"}</div>
            <div>Reference vs pool</div>
            <div className="v">{gapBps === null ? "—" : `${gapBps} bps`}</div>
            <div>Chainlink reference updated</div>
            <div className="v">
              {ref
                ? new Date(ref.updatedAt * 1000)
                    .toISOString()
                    .replace("T", " ")
                    .replace(".000Z", " UTC")
                : "—"}
            </div>
          </div>
          <p className="swap-meta">
            The Chainlink reference informs the trade direction and deposit.
            Settlement uses a qualifying signed Pyth price. This screen focuses
            on the reference gap; the deployed hook still evaluates its full
            execution-time rules. A deposit alone does not prove drift triggered it.
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
