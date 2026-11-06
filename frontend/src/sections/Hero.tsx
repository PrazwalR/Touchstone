import { ActionLink } from "@/components/ActionLink";
import { useRef, useState, type PointerEvent } from "react";
import type { Motion } from "../hooks/useMotion.ts";
import {
  engine,
  HY,
  PATHS,
  paintFlow,
  paintStreak,
  type Pt,
  type Stage,
  type V3,
  type View,
} from "../stone/engine.ts";
import {
  clamp,
  CYAN,
  DEMO,
  DEP,
  DIAL,
  KEYN,
  paintDeposit,
  part,
  pulseAt,
  sm,
  streakAll,
  tag,
  VAULT,
} from "../stone/kit.ts";
import { redraw, useStage } from "../stone/useStage.ts";

const AWAITING = "Illustrative record · awaiting a signed price";
const OUTCOME_A =
  "Outcome A · worked example · R $320 retained · $1,180 refunded";
const OUTCOME_B =
  "Outcome B · worked example · nothing retained · $600 refunded";
const MAX_STROKES = 24;
const MAX_POINTS = 420;
const MAX_SPARKS = 40;

interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
}

export function Hero({
  motion,
  onMarks,
}: {
  motion: Motion;
  onMarks(n: number): void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [outcome, setOutcome] = useState(AWAITING);
  const still = useRef(!motion.cine);
  still.current = !motion.cine;
  const r = useRef({
    outcome: AWAITING,
    cyc: 0,
    A: true,
    narrow: false,
    lastT: 0,
    sparks: [] as Spark[],
    down: false,
    stroke: null as { pts: Pt[]; last: number } | null,
    lastPtr: null as { x: number; y: number; ts: number } | null,
  });

  const cycle = (t: number) => {
    const tt = still.current ? 4.25 : t;
    return {
      tt,
      cyc: tt % 6,
      A: still.current ? true : Math.floor(tt / 6) % 2 === 0,
    };
  };

  const stage = useStage(
    canvas,
    {
      maxDpr: 1.5,
      flatFit: (w, h): V3 | null => {
        if (w / h < 1.05) return null;
        const sw = Math.min(w * 0.52, h * 0.78 * 1.6);
        return [w - sw - w * 0.05, (h - sw / 1.6) / 2 + h * 0.05, sw];
      },
      scene: (t, s: Stage) => {
        const narrow = s.cssW / s.cssH < 1.05;
        const hc = cycle(t);
        r.current.cyc = hc.cyc;
        r.current.A = hc.A;
        r.current.narrow = narrow;
        const view: View = narrow
          ? {
              pos: [0.0, 3.6, 3.0],
              target: [0.0, -0.1, 0.06],
              focal: 1.0,
              shift: [0, -0.02],
            }
          : {
              pos: [1.0, 1.9, 3.2],
              target: [0.25, -0.12, 0.05],
              focal: 1.22,
              shift: [0.44, -0.16],
            };
        if (!still.current && !narrow)
          view.pos = [
            view.pos[0] + Math.sin(t * 0.11) * 0.06,
            view.pos[1],
            view.pos[2] + Math.cos(t * 0.09) * 0.04,
          ];
        const ref = sm(3.45, 3.65, hc.cyc) * (1 - sm(5.5, 5.95, hc.cyc));
        const label = hc.cyc < 3.5 ? AWAITING : hc.A ? OUTCOME_A : OUTCOME_B;
        if (label !== r.current.outcome) {
          r.current.outcome = label;
          setOutcome(label);
        }
        return {
          view,
          pulse: still.current
            ? [DIAL[0], DIAL[1], 0.8, 0.85]
            : pulseAt(hc.tt, 3, 1.8, 1),
          keyN: KEYN,
          ref,
          beam: 0.08 + Math.sin(t * 0.07) * 0.12,
          exposure: 1.05,
        };
      },
      paint: (g, t) => {
        streakAll(g, engine().userStrokes, t, true);
        const { cyc, A } = r.current;
        const drawF = clamp((cyc - 0.55) / 0.9, 0, 1);
        if (drawF > 0) {
          const fade = 1 - sm(5.55, 5.98, cyc);
          const pres = A ? 1 : 1 - 0.72 * sm(3.6, 4.6, cyc);
          const heatFn = (pt: Pt) => {
            const tu = 0.55 + pt[2] * 0.9;
            let h = cyc >= tu ? Math.exp(-(cyc - tu) / 0.7) : 0;
            if (cyc > 3.55) h = A ? 0.5 * Math.exp(-(cyc - 3.55) / 0.35) : 0;
            return h * fade;
          };
          paintStreak(g, part(DEMO, 0, drawF), heatFn, pres * fade, 0.015);
        }
        paintDeposit(g, sm(1.3, 1.8, cyc) * (1 - sm(3.8, 5.2, cyc)));
        if (cyc > 3.75 && cyc < 5.7) {
          const s = ((cyc - 3.75) / 1.5) * 1.3;
          if (A) {
            paintFlow(g, PATHS.toVault, s, 3, 0.07, 1);
            paintFlow(g, PATHS.toTrader, s, 9, 0.045, 0.55);
          } else paintFlow(g, PATHS.toTrader, s, 12, 0.045, 0.6);
        }
      },
      overlay: (ctx, proj, t, P) => {
        const st = r.current;
        const dtm = Math.min(0.05, Math.max(0, t - (st.lastT || t)));
        st.lastT = t;
        if (st.sparks.length) {
          ctx.save();
          ctx.globalCompositeOperation = "lighter";
          st.sparks = st.sparks.filter((sp) => (sp.life += dtm) < sp.max);
          for (const sp of st.sparks) {
            sp.x += sp.vx * dtm * 1000;
            sp.y += sp.vy * dtm * 1000;
            sp.vy += 0.0006 * dtm * 1000;
            ctx.strokeStyle = `rgba(255,210,122,${0.85 * (1 - sp.life / sp.max)})`;
            ctx.lineWidth = 1.1;
            ctx.beginPath();
            ctx.moveTo(sp.x, sp.y);
            ctx.lineTo(sp.x - sp.vx * 14, sp.y - sp.vy * 14);
            ctx.stroke();
          }
          ctx.restore();
        }
        const W = stage.current?.cssW ?? 1000;
        const minX = st.narrow ? 0 : W * 0.47;
        const at = (x: number, z: number) => {
          const p = proj(x, HY, z);
          return p && p[0] > minX ? p : null;
        };
        const refOn = (P.ref ?? 0) > 0.5;
        tag(
          ctx,
          at(DIAL[0], DIAL[1] - 0.5),
          34,
          -46,
          refOn
            ? "P* · SIGNED PRICE (ILLUSTRATED)"
            : "P* · AWAITING A SIGNED PRICE",
          { dot: refOn ? CYAN : null, color: refOn ? CYAN : null },
        );
        if (!st.narrow) {
          tag(
            ctx,
            at(DEMO[60][0], DEMO[60][1]),
            -26,
            -40,
            "RECORD 0x01 · ILLUSTRATIVE",
            { alpha: sm(0.9, 1.4, st.cyc) },
          );
          tag(ctx, at(VAULT[0], VAULT[1] + 0.33), 24, 34, "LPs · VESTED");
          tag(
            ctx,
            at(DEP[0] + 0.17, DEP[1] + 0.05),
            26,
            44,
            "D · REFUNDABLE DEPOSIT",
          );
        }
      },
    },
    motion.cine,
  );

  const addMark = (e: PointerEvent<HTMLDivElement>) => {
    const s = stage.current;
    if (!s) return;
    const eng = engine();
    const p = eng.pickTop(s, e.clientX, e.clientY);
    const st = r.current;
    if (!eng.inside(p)) {
      st.stroke = null;
      return;
    }
    const t = eng.now();
    if (!st.stroke || t - st.stroke.last > 0.35) {
      st.stroke = { pts: [], last: t };
      eng.userStrokes.push(st.stroke);
      if (eng.userStrokes.length > MAX_STROKES) eng.userStrokes.shift();
      onMarks(eng.userStrokes.length);
    }
    const lp = st.stroke.pts[st.stroke.pts.length - 1];
    if (!lp || Math.hypot(p[0] - lp[0], p[1] - lp[1]) > 0.006) {
      st.stroke.pts.push([p[0], p[1], t]);
      st.stroke.last = t;
      if (st.stroke.pts.length > MAX_POINTS) st.stroke.pts.shift();
    }
    const rect = s.canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    if (st.lastPtr && !still.current) {
      const dt = Math.max(1, e.timeStamp - st.lastPtr.ts);
      const vx = (sx - st.lastPtr.x) / dt;
      const vy = (sy - st.lastPtr.y) / dt;
      const sp = Math.hypot(vx, vy);
      if (sp > 0.55 && st.sparks.length < MAX_SPARKS) {
        for (let i = 0; i < (sp > 1.6 ? 2 : 1); i++) {
          st.sparks.push({
            x: sx,
            y: sy,
            vx: (Math.random() - 0.5) * 0.22 + vx * 0.08,
            vy: (Math.random() - 0.85) * 0.2,
            life: 0,
            max: 0.22 + Math.random() * 0.3,
          });
        }
      }
    }
    st.lastPtr = { x: sx, y: sy, ts: e.timeStamp };
    redraw(stage);
  };
  const up = () => {
    r.current.down = false;
    r.current.stroke = null;
    r.current.lastPtr = null;
  };

  const heroH = motion.cine
    ? Math.max(660, Math.min(motion.viewportH - 64, 980))
    : 820;

  return (
    <section
      id="top"
      className="hero"
      style={{ minHeight: heroH }}
      aria-labelledby="hero-title"
    >
      <div
        className="hero-stage"
        onPointerMove={(e) => {
          if (e.pointerType === "touch" && !r.current.down) return;
          addMark(e);
        }}
        onPointerDown={(e) => {
          r.current.down = true;
          r.current.stroke = null;
          addMark(e);
        }}
        onPointerUp={up}
        onPointerLeave={up}
        onPointerCancel={up}
      >
        <canvas className="stage-canvas" ref={canvas} aria-hidden="true" />
        <p className="sr">
          An illustrative black stone. Moving the pointer across it draws a gold
          streak. Every three seconds a ring of light crosses the stone as a
          visual rhythm; an illustrative record is judged and its deposit either
          splits between liquidity providers and a refund, or is refunded in
          full. Nothing on this page submits a trade or moves funds.
        </p>
      </div>
      <div className="hero-copy wrap">
        <h1 id="hero-title" className="h-display hero-h1">
          <span>Every trade</span>
          <span>
            leaves a mark<span className="dot">.</span>
          </span>
        </h1>
        <p className="lead">
          A settlement hook for Uniswap v4. Flagged swaps post a deposit. A
          signed price measures the edge. Liquidity providers share in the
          excess; the rest returns to the trader.
        </p>
        <div className="cta-row">
          <ActionLink variant="default" href="#mechanism">
            See how it settles <span className="arr">↗</span>
          </ActionLink>
          <ActionLink href="#/simulation">Try the testnet</ActionLink>
        </div>
      </div>
      <div className="hero-foot wrap">
        <p className="tl">Draw on the stone</p>
        <p className="tl gold">{outcome}</p>
      </div>
    </section>
  );
}
