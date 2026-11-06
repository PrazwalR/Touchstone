import { E2, E5, E6 } from "../content/evidence.ts";
import { href } from "../router.ts";

const pct = (v: number, places = 1) => `${(v * 100).toFixed(places)}%`;
const usd0 = (v: number) =>
  `$${Math.round(v).toLocaleString("en-US")}`;

/**
 * How the trigger scored on real Ethereum swaps it had never been tuned on, with what the score does not say
 * beside it. Every figure is E2's, E5's or E6's committed result; see research/results.
 */
export function BacktestScore() {
  const caught = E2.toxicMarkoutUsd * E2.recall;
  return (
    <section className="score" aria-labelledby="score-title">
      <div className="score-head">
        <p className="eyebrow">Historical backtest · gate G1</p>
        <h2 id="score-title" className="h3">
          How the trigger scored on {E2.swaps.toLocaleString("en-US")} real
          Ethereum swaps
        </h2>
        <p className="body">
          Uniswap v3 USDC/WETH 0.05% on mainnet, 27 September to 25 October
          2026, a window held out from calibration. The fair price is Binance's
          one-second close. A swap is toxic when its markout three seconds later
          exceeds the fee plus a 2 bp margin.
        </p>
      </div>
      <div className="score-grid">
        <div className="score-main">
          <span className="tl">Toxic markout caught</span>
          <strong>{pct(E2.recall)}</strong>
          <span className="score-ci">
            95% interval {pct(E2.recallCi[0])} to {pct(E2.recallCi[1])}
          </span>
          <p>
            {usd0(caught)} of the window's {usd0(E2.toxicMarkoutUsd)} in toxic
            markout sat in swaps the trigger would have flagged.
          </p>
        </div>
        <div className="score-cell">
          <span className="tl">Swaps asked for a deposit</span>
          <strong>{pct(E2.phiCount)}</strong>
          <p>Gate: at most 30% by count. Passed.</p>
        </div>
        <div className="score-cell">
          <span className="tl">Volume asked for a deposit</span>
          <strong>{pct(E2.phiVolume)}</strong>
          <p>The cost side: capital is held on most volume until settlement.</p>
        </div>
        <div className="score-cell">
          <span className="tl">Recall by week</span>
          <strong className="score-weeks">
            {E2.weeklyRecall.map((w) => pct(w)).join(" · ")}
          </strong>
          <p>
            Spec-default trigger: {pct(E2.defaultTrigger.recall)} recall,{" "}
            {pct(E2.defaultTrigger.phiCount)} flagged.
          </p>
        </div>
      </div>
      <ul className="score-limits">
        <li>
          <b>Detection, not LP returns.</b> The score says where toxic flow
          sits, not that LPs earn more. LPs were net ahead in this window, so
          the break-even recall r* is negative ({E2.rStar.toFixed(2)}).
        </li>
        <li>
          <b>Splitting evades it.</b> In E5, splitting into pieces under a tenth
          of N_min across blocks drops held-out recall to{" "}
          {pct(E5.worstHeldoutRecall)}. Simulation.
        </li>
        <li>
          <b>Freshness failed.</b> E6 killed all {E6.cases} registered cases:
          the simulated pool tracked the market worse than a static-fee pool.
          Simulation.
        </li>
        <li>
          <b>Settlement replay pending.</b> E3 replays retention against
          historical Pyth prices; its download is in progress.
        </li>
      </ul>
      <a className="btn btn-sm" href={href("docs")}>
        Every number, its pre-registration and reproduction{" "}
        <span className="arr">→</span>
      </a>
    </section>
  );
}
