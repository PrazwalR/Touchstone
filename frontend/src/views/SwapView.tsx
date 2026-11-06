import { useCallback, useState } from "react";
import { deployment } from "../chain/deployment.ts";
import type { Live } from "../chain/useLive.ts";
import { RecordTracker } from "../components/RecordTracker.tsx";
import { SwapPanel } from "../components/SwapPanel.tsx";
import { swapContext } from "../swap/context.ts";
import type { SwapResult } from "../swap/swap.ts";
import type { TrackedRecord } from "../swap/useSwapFlow.ts";
import { Columns, NetLine } from "../sections/Testnet.tsx";

/** A DEX-style swap on the testnet pool, with everything Touchstone does to it shown before and after signing. */
export function SwapView({ live, now }: { live: Live; now: number }) {
  const [tracked, setTracked] = useState<TrackedRecord | null>(null);
  const cfg = live.snapshot?.config;
  const onSwapped = useCallback((r: SwapResult) => {
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

  return (
    <section className="view" aria-labelledby="swap-title">
      <div className="wrap view-head">
        <h1 id="swap-title" className="h2">
          Swap with Touchstone.
        </h1>
        <p className="lead">
          See the quote and refundable deposit before you sign. Follow any
          flagged swap through to settlement on {deployment.name}.
        </p>
      </div>
      <div className="wrap swap-grid">
        <SwapPanel ctx={swapContext} initialAmount="1" onSwapped={onSwapped} />
        <div className="swap-side">
          {tracked ? (
            <RecordTracker
              ctx={swapContext}
              tracked={tracked}
              onChange={setTracked}
              {...(cfg
                ? { settleDelay: cfg.settleDelay, windowSeconds: cfg.window }
                : {})}
            />
          ) : (
            <div className="explain">
              <ol className="track-steps">
                <li>
                  <b>It executes at the pool's price</b>
                  <span>
                    On an exact-input swap, a refundable deposit reduces what
                    you receive now. On an exact-output swap, it increases what
                    you pay.
                  </span>
                </li>
                <li>
                  <b>Large or fast-moving swaps are flagged</b>
                  <span>
                    The first large swap of a block, sustained flow, or a swap
                    toward a stale pool price posts a deposit. Repeated small
                    swaps can trigger the flow rule.
                  </span>
                </li>
                <li>
                  <b>A signed price settles it a few seconds later</b>
                  <span>
                    A signed Pyth price measures the trade. Excess markout
                    partly goes to LPs; the remaining deposit returns to you.
                    Benign flow can also earn a rebate.
                  </span>
                </li>
                <li>
                  <b>Nothing can trap your deposit</b>
                  <span>
                    If nobody settles within the window, anyone can expire the
                    record and you are refunded in full.
                  </span>
                </li>
              </ol>
              <p className="src">
                You need testnet ETH and USDC on {deployment.name}. Circle's
                faucet (faucet.circle.com) gives testnet USDC.
              </p>
            </div>
          )}
        </div>
      </div>
      <div className="wrap view-live">
        <NetLine live={live} now={now} />
        <Columns live={live} />
      </div>
    </section>
  );
}
