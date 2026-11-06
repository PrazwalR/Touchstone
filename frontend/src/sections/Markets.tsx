import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "@/components/ui/accordion";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useRef, useState } from "react";
import { FACETS } from "../content/acts.ts";
import type { Motion } from "../hooks/useMotion.ts";
import { KEYF } from "../stone/kit.ts";
import { redraw, useStage } from "../stone/useStage.ts";

function Clawback() {
  return (
    <div className="panel">
      <h3 className="h3">The edge beyond the margin.</h3>
      <svg
        className="diag"
        viewBox="0 0 560 230"
        role="img"
        aria-label="Worked example on a line: markout of $500 from the reference P*, the first $100 is margin, the $400 excess is 80 percent retained, R equals $320, below the $1,500 deposit cap."
      >
        <defs>
          <pattern
            id="hatch"
            width="6"
            height="6"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(45)"
          >
            <line
              x1="0"
              y1="0"
              x2="0"
              y2="6"
              stroke="rgba(243,239,231,.28)"
              strokeWidth="1.5"
            />
          </pattern>
        </defs>
        <line
          x1="40"
          y1="160"
          x2="530"
          y2="160"
          stroke="rgba(243,239,231,.16)"
        />
        <line
          x1="40"
          y1="52"
          x2="40"
          y2="172"
          stroke="#F3EFE7"
          strokeWidth="1.2"
        />
        <text x="34" y="192" fill="#F3EFE7">
          P*
        </text>
        <rect
          className="fi"
          x="40"
          y="96"
          width="80"
          height="44"
          fill="url(#hatch)"
          stroke="rgba(243,239,231,.25)"
        />
        <text className="fi" x="44" y="86" fill="#B2ADA4">
          margin (ε+c*)·N⁺ $100
        </text>
        <line
          className="dr"
          x1="40"
          y1="118"
          x2="440"
          y2="118"
          stroke="#E8B44A"
          strokeWidth="2.5"
        />
        <text className="fi d1" x="446" y="122" fill="#E8B44A">
          m⁺ $500
        </text>
        <line
          className="fi d2"
          x1="120"
          y1="118"
          x2="376"
          y2="118"
          stroke="#FFD27A"
          strokeWidth="8"
          strokeLinecap="butt"
        />
        <path
          className="fi d2"
          d="M120 146 L120 152 L440 152 L440 146"
          fill="none"
          stroke="rgba(243,239,231,.35)"
        />
        <text className="fi d2" x="210" y="172" fill="#B2ADA4">
          excess $400
        </text>
        <text className="fi d3" x="120" y="62" fill="#FFD27A">
          R = α · excess = 0.8 × $400 = $320
        </text>
        <line
          className="fi d3"
          x1="248"
          y1="68"
          x2="248"
          y2="110"
          stroke="rgba(255,210,122,.6)"
          strokeDasharray="2 3"
        />
        <text className="fi d3" x="300" y="212" fill="#8C877F">
          cap D = $1,500 · not binding
        </text>
      </svg>
      <Accordion>
        <AccordionItem value="details">
          <AccordionTrigger>Settlement math</AccordionTrigger>
          <AccordionContent>
            <div className="chips">
              <Badge variant="outline" className="chip chip-impl">
                Math implemented · tested
              </Badge>
              <Badge variant="outline" className="chip chip-impl">
                Settler · deployed on testnet
              </Badge>
            </div>

            <pre className="formula">{`R = min( D , α · max(0, m⁺ − (ε + c*) · N⁺) )
refund = D − R            (exact: refund + R = D)`}</pre>
            <dl className="terms">
              <dt>D</dt>
              <dd>
                Deposit, N · min(δmax, max(δ, β·g⁺)); scales with the pre-swap
                gap g toward the reference.
              </dd>
              <dt>m⁺, N⁺</dt>
              <dd>
                Markout and notional of the in-the-money leg only: units traded
                past P* are excluded, so padding a swap cannot dilute it.
              </dd>
              <dt>ε, c*</dt>
              <dd>
                Margin plus Pyth confidence. Confidence rounds up, which can
                only lower R.
              </dd>
              <dt>α</dt>
              <dd>
                LPs’ share for the record’s regime (see the licence facet).
              </dd>
            </dl>
            <div className="ex">
              <div>
                <p className="k">Deposit</p>
                <p className="v">$1,500</p>
              </div>
              <div>
                <p className="k">Retained R</p>
                <p className="v">$320</p>
              </div>
              <div>
                <p className="k">Refund</p>
                <p className="v">$1,180</p>
              </div>
              <div>
                <p className="k">Effective fee</p>
                <p className="v">11.4 bps</p>
              </div>
            </div>
            <p className="src">
              src/libraries/SettlementMath.sol · clawback() · ItmLib.leg() ·
              DepositLib.rateBps() · research report, worked example
            </p>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  );
}

function Licence() {
  return (
    <div className="panel">
      <h3 className="h3">An exemption you can lease.</h3>
      <svg
        className="diag"
        viewBox="0 0 560 230"
        role="img"
        aria-label="A key inside concentric lock rings. The outer ring represents the lease's prepaid time; a highlighted arc marks the band G around the reference price inside which the exemption applies."
      >
        <circle
          cx="130"
          cy="115"
          r="84"
          fill="none"
          stroke="rgba(243,239,231,.14)"
        />
        <circle
          className="dr"
          cx="130"
          cy="115"
          r="84"
          fill="none"
          stroke="#E8B44A"
          strokeWidth="1.5"
          transform="rotate(-90 130 115)"
        />
        <circle
          cx="130"
          cy="115"
          r="66"
          fill="none"
          stroke="rgba(243,239,231,.22)"
          strokeDasharray="2 5"
        />
        <path
          className="fi d1"
          d="M 84.6 70.8 A 66 66 0 0 1 175.4 70.8"
          fill="none"
          stroke="#FFD27A"
          strokeWidth="4"
        />
        <circle
          cx="130"
          cy="115"
          r="40"
          fill="none"
          stroke="rgba(243,239,231,.3)"
        />
        <circle
          cx="130"
          cy="115"
          r="14"
          fill="none"
          stroke="#E8B44A"
          strokeWidth="2"
        />
        <path
          className="fi d2"
          d="M144 115 H196 V126 M182 115 V124"
          fill="none"
          stroke="#E8B44A"
          strokeWidth="2"
          strokeLinecap="round"
        />
        <text className="fi d1" x="96" y="40" fill="#FFD27A">
          band G around P*
        </text>
        <text x="252" y="58" fill="#F3EFE7">
          lease time = deposit ÷ rent per second
        </text>
        <text x="252" y="80" fill="#B2ADA4">
          36,000 ÷ 10 /s → lapses at 3,600 s
        </text>
        <text x="252" y="118" fill="#F3EFE7">
          a new bid must beat max(top, next)
        </text>
        <text x="252" y="140" fill="#B2ADA4">
          by the minimum increment: +10%,
        </text>
        <text x="252" y="160" fill="#B2ADA4">
          1,001 → 1,102 (rounds up)
        </text>
        <text x="252" y="198" fill="#8C877F">
          reference examples, research/reference
        </text>
      </svg>
      <Accordion>
        <AccordionItem value="details">
          <AccordionTrigger>Licence rules</AccordionTrigger>
          <AccordionContent>
            <div className="chips">
              <Badge variant="outline" className="chip chip-impl">
                Regime function · implemented
              </Badge>
              <Badge variant="outline" className="chip chip-illu">
                Lease pricing · Python reference
              </Badge>
              <Badge variant="outline" className="chip chip-impl">
                Licence contract · implemented, tested
              </Badge>
              <Badge variant="outline" className="chip chip-none">
                Not on the testnet yet
              </Badge>
            </div>

            <div className="regime">
              <div>Closure record (reference market closed)</div>
              <div className="a">α_c</div>
              <div>No live lease, or pool price outside band G of P*</div>
              <div className="a">α · 80%</div>
              <div>
                Live lease, in band, the holder’s first swap in the block
              </div>
              <div className="a gold">0</div>
              <div>Live lease, in band, anyone else</div>
              <div className="a">α_lic · 95%</div>
            </div>
            <p className="body">
              Rent is paid per second from a prepaid deposit and stops when it
              runs out. Rent, like retained value, is released to in-range LPs
              gradually over the vesting period. On Arbitrum the “first swap in
              the block” uses the L2 block number from ArbSys, because
              block.number there approximates the parent chain.
            </p>
            <p className="body">
              The lease auction is built and tested (milestone M9) but not
              deployed: the contracts on Arbitrum Sepolia predate it, so the
              live pool settles in the first two rows only until a redeployment.
              No pool enables the licence before the E10 simulation shows it
              helps LPs.
            </p>
            <p className="src">
              SettlementMath.alphaBps() · BlockLib.number() · touchstone_ref.py
              min_next_rent(), rent_due() · VestingLib.releasable()
            </p>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  );
}

function Rebates() {
  return (
    <div className="panel">
      <h3 className="h3">A rebate for benign flow.</h3>
      <svg
        className="diag"
        viewBox="0 0 560 230"
        role="img"
        aria-label="Several order-flow lines converge at a router node. From it, the full deposit returns to the beneficiary, a rebate from the rebate pool goes to the rebateTo address, and a small tip goes to the settlement caller."
      >
        <path
          className="dr"
          d="M24 40 C 120 40, 160 110, 236 115"
          fill="none"
          stroke="rgba(232,180,74,.7)"
          strokeWidth="1.4"
        />
        <path
          className="dr"
          d="M24 84 C 120 84, 170 112, 236 115"
          fill="none"
          stroke="rgba(232,180,74,.7)"
          strokeWidth="1.4"
        />
        <path
          className="dr"
          d="M24 146 C 120 146, 170 118, 236 115"
          fill="none"
          stroke="rgba(232,180,74,.7)"
          strokeWidth="1.4"
        />
        <path
          className="dr"
          d="M24 190 C 120 190, 160 120, 236 115"
          fill="none"
          stroke="rgba(232,180,74,.7)"
          strokeWidth="1.4"
        />
        <circle
          cx="244"
          cy="115"
          r="9"
          fill="#0A0A0B"
          stroke="#E8B44A"
          strokeWidth="2"
        />
        <text x="210" y="148" fill="#B2ADA4">
          router
        </text>
        <path
          className="fi d1"
          d="M254 112 C 320 100, 360 52, 400 52"
          fill="none"
          stroke="rgba(243,239,231,.5)"
          strokeWidth="1.4"
          strokeDasharray="3 4"
        />
        <text className="fi d1" x="406" y="48" fill="#F3EFE7">
          refund $600
        </text>
        <text className="fi d1" x="406" y="64" fill="#8C877F">
          full deposit
        </text>
        <path
          className="fi d2"
          d="M254 116 L400 116"
          fill="none"
          stroke="#E8B44A"
          strokeWidth="2.2"
        />
        <text className="fi d2" x="406" y="112" fill="#FFD27A">
          rebate $39.20
        </text>
        <text className="fi d2" x="406" y="128" fill="#8C877F">
          → rebateTo
        </text>
        <path
          className="fi d3"
          d="M254 120 C 320 132, 360 180, 400 180"
          fill="none"
          stroke="#E8B44A"
          strokeWidth="1"
          strokeDasharray="1 3"
        />
        <text className="fi d3" x="406" y="176" fill="#F3EFE7">
          tip $0.80
        </text>
        <text className="fi d3" x="406" y="192" fill="#8C877F">
          settlement caller
        </text>
        <text x="24" y="218" fill="#8C877F">
          rebate = min(κ·f·N, pool) · κ 40% of 5 bps on $200,000
        </text>
      </svg>
      <Accordion>
        <AccordionItem value="details">
          <AccordionTrigger>Rebate math</AccordionTrigger>
          <AccordionContent>
            <div className="chips">
              <Badge variant="outline" className="chip chip-impl">
                benign() implemented · fuzzed
              </Badge>
              <Badge variant="outline" className="chip chip-impl">
                Classification · in the Settler
              </Badge>
            </div>

            <pre className="formula">{`benign  ⇔  R = 0 and m ≤ 0
gross  = min( κ · f · N , rebate pool )
tip    = min( tipBps · gross , tipCap )
rebate = gross − tip        → rebateTo
refund = D                  → always in full`}</pre>
            <p className="body">
              The pool that pays rebates is funded by ρ, a share of retained
              value. A wash leg still loses f·(1 − κ), 3 bps per leg at κ = 40%,
              before price impact and gas, and an LP washing in its own pool
              needs more than 60% of in-range liquidity just to break even
              (research report). Rebates are capped by the pool’s balance and
              paid first come, first served; nothing here is guaranteed income.
            </p>
            <p className="src">
              SettlementMath.benign() · Settler._payout() · Payout.rebate →
              rebateTo · conserves(): tip + rebate ≤ pool
            </p>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  );
}

function Quote() {
  return (
    <div className="panel">
      <h3 className="h3">A quote the router can enforce.</h3>
      <svg
        className="diag"
        viewBox="0 0 560 230"
        role="img"
        aria-label="Two engraved lines, the quoted deposit from previewDeposit and the deposit the hook requires, start apart and snap into alignment at a precision marker."
      >
        <line
          x1="60"
          y1="96"
          x2="500"
          y2="96"
          stroke="#E8B44A"
          strokeWidth="2"
        />
        <text x="60" y="82" fill="#E8B44A">
          quoted D · previewDeposit → DepositLib
        </text>
        <g className="sn">
          <line
            x1="60"
            y1="104"
            x2="500"
            y2="104"
            stroke="rgba(243,239,231,.75)"
            strokeWidth="2"
          />
          <text x="60" y="126" fill="#B2ADA4">
            required D · beforeSwap → DepositLib
          </text>
        </g>
        <line
          className="fi d3"
          x1="330"
          y1="64"
          x2="330"
          y2="150"
          stroke="#FFD27A"
          strokeWidth="1"
        />
        <circle
          className="fi d3"
          cx="330"
          cy="100"
          r="5"
          fill="none"
          stroke="#5EF2E1"
          strokeWidth="1.5"
        />
        <text className="fi d3" x="340" y="168" fill="#5EF2E1">
          guard check · illustrated
        </text>
        <text x="60" y="206" fill="#8C877F">
          same function, same rounding: D rounds down; R rounds down; refund = D
          − R exactly
        </text>
      </svg>
      <Accordion>
        <AccordionItem value="details">
          <AccordionTrigger>Quote guarantees</AccordionTrigger>
          <AccordionContent>
            <div className="chips">
              <Badge variant="outline" className="chip chip-impl">
                previewDeposit · fuzzed against execution
              </Badge>
              <Badge variant="outline" className="chip chip-impl">
                GuardedRouter · deployed on testnet
              </Badge>
            </div>

            <p className="body">
              previewDeposit runs the swap path’s own trigger and deposit
              functions on current state, so within a block the quote and the
              deposit cannot disagree; a fuzz test of 2,000 runs holds them
              equal. GuardedRouter checks the real deposit inside the
              transaction and reverts when a trader’s limits are not met
              (Touchstone__GuardFailed, Touchstone__DeadlinePassed), and
              finalize refuses any payout that does not conserve
              (Touchstone__PayoutMismatch).
            </p>
            <p className="body">
              This does not remove the swap’s own price impact or slippage. Try
              the deployed view in the testnet section below.
            </p>
            <p className="src">
              TouchstoneHook.previewDeposit() · GuardedRouter.swapGuarded() ·
              DepositLib.quoteAmount() · SettlementMath.conserves()
            </p>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  );
}

const PANELS = [Clawback, Licence, Rebates, Quote];

export function Markets({ motion }: { motion: Motion }) {
  const [facet, setFacet] = useState<number | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const r = useRef({
    facet: null as number | null,
    rot: Math.PI / 4,
    fT: 0,
    still: !motion.cine,
  });
  r.current.facet = facet;
  r.current.still = !motion.cine;
  const stage = useStage(
    canvas,
    {
      maxDpr: 1.5,
      scene: (t) => {
        const st = r.current;
        const dt = Math.min(0.05, Math.max(0.001, t - (st.fT || t)));
        st.fT = t;
        const target =
          st.facet === null
            ? st.still
              ? Math.PI * 0.25
              : Math.PI * 0.25 + t * 0.16
            : (st.facet * Math.PI) / 2;
        if (st.still) st.rot = target;
        else {
          const d =
            ((((target - st.rot + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) %
              (2 * Math.PI)) -
            Math.PI;
          st.rot += d * (1 - Math.exp(-dt * 4.5));
        }
        return {
          view: { pos: [0, 1.0, 4.5], target: [0, 0.02, 0], focal: 2.05 },
          mode: 1,
          rot: st.rot,
          sel: st.facet ?? -1,
          keyN: KEYF,
          float: st.still ? 0 : Math.sin(t * 0.8) * 0.025,
          exposure: 1.2,
          beam: 0,
        };
      },
    },
    motion.cine,
  );
  const pick = (i: number | null) => {
    setFacet(i);
    r.current.facet = i;
    redraw(stage);
  };
  const Panel = facet === null ? null : PANELS[facet];

  return (
    <section id="markets" className="act" aria-labelledby="markets-title">
      <div className="wrap act-head">
        <div className="stack">
          <h2 id="markets-title" className="h2">
            Four markets, <em>one stone.</em>
          </h2>
        </div>
      </div>
      <div className="wrap facets">
        <div className="facet-stage">
          <canvas ref={canvas} aria-hidden="true" />
          <p className="tl">
            {facet === null
              ? "Assay weight · four facets · turning slowly"
              : `Facet 0${facet + 1} · ${FACETS[facet]}`}
          </p>
        </div>
        <div>
          <ToggleGroup
            className="facet-tabs"
            aria-label="Protocol markets"
            value={facet === null ? [] : [String(facet)]}
            onValueChange={(v) => pick(v.length ? Number(v[0]) : null)}
          >
            {FACETS.map((name, i) => (
              <ToggleGroupItem
                key={name}
                value={String(i)}
                className="facet-tab"
              >
                <span className="n">0{i + 1}</span>
                <span className="nm">{name}</span>
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          {Panel ? (
            <>
              <Panel />
              <div className="run" style={{ marginTop: 22 }}>
                <Button variant="outline" size="sm" onClick={() => pick(null)}>
                  All four facets
                </Button>
              </div>
            </>
          ) : (
            <ul className="facet-list">
              <li>
                <span className="n">01</span>
                <div>
                  <b>Clawback</b>
                  <span className="body">
                    Markout beyond a stated margin on a flagged swap is partly
                    retained from its deposit, never more than the deposit.
                  </span>
                </div>
              </li>
              <li>
                <span className="n">02</span>
                <div>
                  <b>Arbitrage licence</b>
                  <span className="body">
                    A rented lease that exempts one holder’s first swap per
                    block, while the pool price is inside a band around the
                    reference. Built and tested; not yet deployed.
                  </span>
                </div>
              </li>
              <li>
                <span className="n">03</span>
                <div>
                  <b>Benign-flow rebates</b>
                  <span className="body">
                    Flow that settles benign is refunded in full and can earn a
                    rebate, funded by a share of retained value.
                  </span>
                </div>
              </li>
              <li>
                <span className="n">04</span>
                <div>
                  <b>Quote integrity</b>
                  <span className="body">
                    The quote and the requirement come from the same functions,
                    with the same rounding, and a router can enforce it inside
                    the transaction.
                  </span>
                </div>
              </li>
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}
