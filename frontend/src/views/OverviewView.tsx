import { useEffect } from "react";
import { deployment } from "../chain/deployment.ts";
import { priceQuotePerRiskyE6 } from "../chain/reads.ts";
import type { Live } from "../chain/useLive.ts";
import { E2 } from "../content/evidence.ts";
import type { Motion } from "../hooks/useMotion.ts";
import { int, units } from "../format.ts";
import { Closed } from "../sections/Closed.tsx";
import { Closing } from "../sections/Closing.tsx";
import { Hero } from "../sections/Hero.tsx";
import { Lab } from "../sections/Lab.tsx";
import { Markets } from "../sections/Markets.tsx";
import { Mechanism } from "../sections/Mechanism.tsx";
import { Pipeline } from "../sections/Pipeline.tsx";
import { Status } from "../sections/Status.tsx";

/** One line of live testnet state and one research figure, each labelled, linking to where to see more. */
function LiveStrip({ live }: { live: Live }) {
  const s = live.snapshot;
  const Q = deployment.tokens.quote;
  const R = deployment.tokens.risky;
  const cells: [string, string, string][] = [
    [
      "Pool price",
      s
        ? `${units(priceQuotePerRiskyE6(s.sqrtPriceX96), 6, 2)} ${Q.symbol}/${R.symbol}`
        : "—",
      deployment.name,
    ],
    [
      "Records opened",
      s ? int(s.state.nextRecordId) : "—",
      "Measured · testnet pool",
    ],
    [
      "Deposits held",
      s
        ? `${units(s.state.outstanding0, R.decimals, 4)} ${R.symbol} · ${units(s.state.outstanding1, Q.decimals, 2)} ${Q.symbol}`
        : "—",
      "Measured · awaiting settlement",
    ],
    [
      "Trigger recall",
      `${(E2.recall * 100).toFixed(1)}%`,
      "Historical backtest · Ethereum (E2)",
    ],
  ];
  return (
    <div className="wrap strip" aria-label="Live figures">
      {cells.map(([k, v, note]) => (
        <div key={k} className="strip-cell">
          <p className="tl">{k}</p>
          <p className="strip-v">{v}</p>
          <p className="dim">{note}</p>
        </div>
      ))}
    </div>
  );
}

export function OverviewView({
  live,
  motion,
  onMarks,
  marks,
  anchor,
}: {
  live: Live;
  motion: Motion;
  onMarks(n: number): void;
  marks: number;
  anchor: string;
}) {
  // Arriving from another tab with an in-page anchor: scroll to it once the narrative has mounted.
  useEffect(() => {
    if (!anchor) return;
    document.getElementById(anchor)?.scrollIntoView();
  }, [anchor]);
  return (
    <>
      <Hero motion={motion} onMarks={onMarks} />
      <LiveStrip live={live} />
      <Mechanism motion={motion} />
      <Markets motion={motion} />
      <Closed motion={motion} live={live} />
      <Lab motion={motion} live={live} />
      <Pipeline />
      <Status />
      <Closing motion={motion} marks={marks} />
    </>
  );
}
