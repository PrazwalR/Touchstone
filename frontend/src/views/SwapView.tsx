import { useCallback, useState } from "react";
import type { Live } from "../chain/useLive.ts";
import { SwapPanel } from "../components/SwapPanel.tsx";
import {
  DemoHeader,
  DemoDisclosure,
  SettlementPanel,
} from "../components/DemoLayout.tsx";
import { swapContext } from "../swap/context.ts";
import type { SwapResult } from "../swap/swap.ts";
import type { TrackedRecord } from "../swap/useSwapFlow.ts";
import { PoolDetails } from "../sections/Testnet.tsx";

export function SwapView({ live, now }: { live: Live; now: number }) {
  const [tracked, setTracked] = useState<TrackedRecord | null>(null);
  const [result, setResult] = useState<SwapResult | null>(null);
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
  return (
    <section className="demo-view wrap" aria-labelledby="swap-title">
      <DemoHeader id="swap-title" title="Swap" live={live} next="simulation" />
      <div className="demo-grid">
        <SwapPanel
          ctx={swapContext}
          initialAmount="1"
          onSwapped={onSwapped}
          title="ETH / USDC"
        />
        <SettlementPanel
          ctx={swapContext}
          tracked={tracked}
          onChange={setTracked}
          result={result}
          live={live}
        />
      </div>
      <div className="demo-extras">
        <DemoDisclosure title="How deposits work">
          <div className="demo-explain-grid">
            <div>
              <h3>Trade at the pool price</h3>
              <p>
                Flagged swaps post a refundable deposit. For exact input it
                reduces what you receive now; for exact output it increases what
                you pay.
              </p>
            </div>
            <div>
              <h3>Settle against a signed price</h3>
              <p>
                A qualifying Pyth price measures the trade’s markout. Part of
                the excess can be retained, chiefly for LPs. Benign flow
                receives a full refund and can earn a rebate.
              </p>
            </div>
            <div>
              <h3>A refund if time runs out</h3>
              <p>
                If the record remains unsettled past its window, anyone can
                expire it for a full deposit refund.
              </p>
            </div>
          </div>
          <p className="swap-meta">
            Use testnet ETH and USDC. Testnet USDC is available from{" "}
            <a
              href="https://faucet.circle.com/"
              target="_blank"
              rel="noreferrer"
            >
              Circle’s faucet ↗
            </a>
            .
          </p>
        </DemoDisclosure>
        <DemoDisclosure title="Live pool data and configuration">
          <PoolDetails live={live} now={now} />
        </DemoDisclosure>
      </div>
    </section>
  );
}
