import { Button } from "@/components/ui/button";
import { useCallback, useEffect, useState } from "react";
import { deployment } from "../chain/deployment.ts";
import { priceQuotePerRiskyE6, readEvents } from "../chain/reads.ts";
import type { Live } from "../chain/useLive.ts";
import { RecordTracker } from "../components/RecordTracker.tsx";
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
    if (r.record)
      setTracked({
        poolId: r.record.poolId,
        recordId: r.record.id,
        fromBlock: r.receipt.blockNumber,
        timestamp: r.record.timestamp,
        deposit: r.record.deposit,
        depositIn0: r.record.depositIn0,
        outcome: { kind: "open" },
      });
  }, []);

  const followLatest = async () => {
    setLatestError(null);
    try {
      const events = await readEvents();
      const d = events.find((e) => e.kind === "deposit");
      if (!d || d.kind !== "deposit") {
        setLatestError(
          "No flagged swap on this pool yet. Make one in step 2, or run the outsider bot.",
        );
        return;
      }
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
    }
  };

  return (
    <section className="view" aria-labelledby="sim-title">
      <div className="wrap view-head">
        <h1 id="sim-title" className="h2">
          Follow an arbitrage.
        </h1>
        <p className="lead">
          Make a real testnet swap, then follow the deposit, signed price and
          payout. Your wallet signs each transaction.
        </p>
      </div>

      <div className="wrap sim-steps">
        <div className="sim-step">
          <h2 className="h3">The situation, read live</h2>
          <div className="kv">
            <div>Pool price</div>
            <div className="v">
              {poolE6 === null ? "—" : `${units(poolE6, 6, 2)} ${Q.symbol}`}
            </div>
            <div>Chainlink reference</div>
            <div className="v">
              {ref
                ? `${units(ref.priceE6, 6, 2)} ${Q.symbol}`
                : refError
                  ? "unavailable"
                  : "—"}
            </div>
            <div>Gap, reference over pool</div>
            <div className="v em">
              {gapBps === null ? "—" : `${gapBps > 0 ? "+" : ""}${gapBps} bps`}
            </div>
            <div>Large-swap threshold N₀</div>
            <div className="v">
              {n0 === null ? "—" : `${units(n0, Q.decimals, 2)} ${Q.symbol}`}
            </div>
            <div>Drift threshold τ</div>
            <div className="v">{s ? `${s.config.tauBps} bps` : "—"}</div>
          </div>
          <p className="body">
            {gapBps === null
              ? "Reading prices…"
              : `An arbitrageur ${side === "buy" ? "buys" : "sells"} ${R.symbol} here, moving the pool toward the reference. A swap of at least N₀ that is the first large swap in its block is flagged on size alone; one toward a stale pool price beyond the drift threshold is flagged on drift.`}
          </p>
          {refError && <p className="err">Reference unavailable: {refError}</p>}
        </div>

        <div className="sim-step">
          <h2 className="h3">Make the trade</h2>
          {preset === null ? (
            <p className="empty">Reading the pool's thresholds…</p>
          ) : (
            <SwapPanel
              key={`${side}-${preset}`}
              ctx={swapContext}
              initialSide={side}
              initialAmount={preset}
              onSwapped={onSwapped}
              title="Arbitrage swap"
            />
          )}
          <p className="src">
            Pre-filled at 1.2 × N₀ in the direction of the reference. Change it
            freely. No wallet?{" "}
            <Button
              variant="link"
              className="inline-action"
              onClick={() => void followLatest()}
            >
              Follow the latest flagged swap on the pool instead
            </Button>
            .
          </p>
          {latestError && <p className="err">{latestError}</p>}
        </div>

        <div className="sim-step">
          <h2 className="h3">Deposit, settlement, payout</h2>
          {tracked ? (
            <RecordTracker
              ctx={swapContext}
              tracked={tracked}
              onChange={setTracked}
              {...(s
                ? {
                    settleDelay: s.config.settleDelay,
                    windowSeconds: s.config.window,
                  }
                : {})}
            />
          ) : (
            <p className="empty">
              Once a flagged swap lands, its record appears here: the deposit
              held, the countdown to t₀, the settlement, and how the deposit was
              split.
            </p>
          )}
        </div>
      </div>

      <div className="wrap view-live">
        {!HISTORY_URL && <Records live={live} />}
        <History />
        <Licence />
      </div>
    </section>
  );
}
