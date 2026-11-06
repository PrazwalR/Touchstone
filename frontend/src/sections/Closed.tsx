import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import { useEffect, useRef, useState } from "react";
import { deployment, explorerAddress } from "../chain/deployment.ts";
import type { Live } from "../chain/useLive.ts";
import { CLOSED_TICKS } from "../content/acts.ts";
import { utc } from "../format.ts";
import type { Motion } from "../hooks/useMotion.ts";
import { HY, PATHS, paintFlow, paintStreak, type V4 } from "../stone/engine.ts";
import {
  clamp,
  CYAN,
  DEMO,
  DIAL,
  FROST,
  KEYN,
  lerp,
  paintDeposit,
  pulseAt,
  sm,
  tag,
} from "../stone/kit.ts";
import { redraw, useStage } from "../stone/useStage.ts";

const START = 22;
const PLAY_MS = 3600;

function CalendarLine({ live }: { live: Live }) {
  const s = live.snapshot;
  if (!s)
    return (
      <p className="cal-line">
        {live.error
          ? `NYSE calendar · not read: ${live.error}`
          : `NYSE calendar · reading ${deployment.name}…`}
      </p>
    );
  if (!deployment.contracts.nyseCalendar || !s.calendar)
    return (
      <p className="cal-line">
        No NYSE calendar deployed on {deployment.name}.
      </p>
    );
  const usesCalendar =
    s.config.calendar.toLowerCase() ===
    deployment.contracts.nyseCalendar.toLowerCase();
  return (
    <>
      <p className="cal-line">
        NYSE calendar, measured on{" "}
        <a
          href={explorerAddress(deployment.contracts.nyseCalendar)}
          target="_blank"
          rel="noreferrer"
        >
          {deployment.name}
        </a>{" "}
        at block {s.blockNumber.toLocaleString("en-US")}: the market is{" "}
        <b>{s.calendar.open ? "open" : "closed"}</b>
        {s.calendar.open ? (
          ""
        ) : (
          <>
            ; next open <b>{utc(s.calendar.nextOpen)}</b>
          </>
        )}
        . Data runs to {utc(s.calendar.validUntil)}.
      </p>
      <p className="body" style={{ fontSize: 14 }}>
        {usesCalendar
          ? "The demo pool uses this calendar, so a large swap made now while the market is closed opens a closure record."
          : "The demo pool is ETH/USDC, whose reference never closes, so it does not use the calendar; a pool on a tokenised equity would. The timeline beside it is an illustration. This is not a trading venue for tokenised stocks."}
      </p>
    </>
  );
}

export function Closed({ motion, live }: { motion: Motion; live: Live }) {
  const [v, setV] = useState(START);
  const canvas = useRef<HTMLCanvasElement>(null);
  const r = useRef({ v: START, still: !motion.cine, raf: 0 });
  r.current.v = v;
  r.current.still = !motion.cine;

  const stage = useStage(
    canvas,
    {
      maxDpr: 1.5,
      scene: (t, s) => {
        const x = r.current.v / 100;
        const narrow = s.cssW / s.cssH < 1.05;
        const settle: V4 =
          !r.current.still && x >= 0.86
            ? pulseAt(t, 3, 1.8, 0.7)
            : [0, 0, 0, 0];
        return {
          view: {
            pos: [-0.55, 1.75, 2.85],
            target: [0.05, -0.1, 0.0],
            focal: narrow ? 1.2 : 1.5,
          },
          cold: 1 - sm(0.8, 0.97, x),
          thaw: sm(0.66, 0.95, x),
          ref: sm(0.84, 0.88, x),
          dial: sm(0.7, 0.86, x),
          pulse: settle,
          keyN: KEYN,
          exposure: 1.05,
          beam: 0.1,
        };
      },
      paint: (g) => {
        const x = r.current.v / 100;
        const heat = 0.05 + 0.5 * sm(0.66, 0.8, x) * (1 - sm(0.8, 0.95, x));
        paintStreak(g, DEMO, () => heat, 1, 0.015);
        paintDeposit(g, 1 - sm(0.9, 1.0, x));
        if (x > 0.9) {
          const s = ((x - 0.9) / 0.1) * 1.25;
          paintFlow(g, PATHS.toVault, s, 2, 0.1, 1);
          paintFlow(g, PATHS.toTrader, s, 7, 0.05, 0.55);
        }
      },
      overlay: (ctx, proj, _t, P) => {
        const x = r.current.v / 100;
        const at = (a: number, z: number) => proj(a, HY, z);
        tag(
          ctx,
          at(DEMO[40][0], DEMO[40][1]),
          -24,
          -40,
          "CLOSURE RECORD · δc · α_c",
          { color: x < 0.8 ? FROST : null },
        );
        if ((P.ref ?? 0) > 0.5)
          tag(
            ctx,
            at(DIAL[0] + 0.1, DIAL[1] - 0.45),
            26,
            -34,
            "SIGNED PRICE AFTER REOPENING (ILLUSTRATED)",
            { dot: CYAN, color: CYAN },
          );
      },
    },
    motion.cine,
  );

  useEffect(() => () => cancelAnimationFrame(r.current.raf), []);
  const set = (x: number) => {
    r.current.v = x;
    setV(x);
    redraw(stage);
  };
  const stop = () => {
    cancelAnimationFrame(r.current.raf);
    r.current.raf = 0;
  };
  const play = () => {
    stop();
    if (motion.reduced) return set(100);
    const from = r.current.v >= 99 ? START : r.current.v;
    const t0 = performance.now();
    const dur = (PLAY_MS * (100 - from)) / (100 - START);
    const step = (now: number) => {
      const k = clamp((now - t0) / dur, 0, 1);
      set(Math.round(lerp(from, 100, k)));
      r.current.raf = k < 1 ? requestAnimationFrame(step) : 0;
    };
    r.current.raf = requestAnimationFrame(step);
  };

  const x = v / 100;
  const text =
    x < 0.8
      ? "Market closed, closure records held"
      : x < 0.86
        ? "Reopened, waiting for a signed price"
        : "Signed price available, settling (illustrated)";

  return (
    <section
      id="closed"
      className={`act act-closed ${x < 0.8 ? "cold" : ""}`}
      aria-labelledby="closed-title"
    >
      <div className="wrap closed">
        <div className="stack">
          <h2 id="closed-title" className="h2">
            When the reference market <em>sleeps.</em>
          </h2>
          <p className="lead">
            When the reference market closes, swaps post a closure deposit.
            Settlement waits for reopening, with a wider margin and a lower
            retention share to account for overnight price noise.
          </p>
          <div className="numbers">
            <div>
              <p className="v">18.2 bps</p>
              <p className="k">
                expected retention on a benign trade with closure settings (α
                50%, ε 50 bps)
              </p>
            </div>
            <div>
              <p className="v">45.1 bps</p>
              <p className="k">
                the same trade if continuous settings (α 80%, ε 2 bps) were
                applied
              </p>
            </div>
          </div>
          <p className="tl">
            Noise-tax model from the research report, σ = 150 bps over the
            closure · illustrative parameters
          </p>
          <div className="scrub">
            <label
              id="closed-range-label"
              className="tl"
              htmlFor="closed-range"
            >
              Reopening timeline · illustration
            </label>
            <Slider
              id="closed-range"
              aria-labelledby="closed-range-label"
              min={0}
              max={100}
              step={1}
              value={[v]}
              onValueChange={(value) => {
                stop();
                set(Number(Array.isArray(value) ? value[0] : value));
              }}
              aria-valuetext={text}
            />
            <div className="ticks">
              {CLOSED_TICKS.map(([label, at]) => (
                <span key={label} className={x >= at ? "on" : ""}>
                  {label}
                </span>
              ))}
            </div>
            <div className="scrub-row">
              <Button variant="outline" size="sm" onClick={play}>
                Play the reopening
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  stop();
                  set(START);
                }}
              >
                Back to closed
              </Button>
            </div>
          </div>
          <CalendarLine live={live} />
        </div>
        <div className="closed-stage">
          <canvas ref={canvas} aria-hidden="true" />
          <p
            className={`mstate ${x < 0.8 ? "is-closed" : "is-open"}`}
            aria-live="polite"
          >
            {x < 0.8 ? "MARKET CLOSED" : "MARKET OPEN"}
          </p>
        </div>
      </div>
    </section>
  );
}
