import { beginAnnotations } from "../stone/annotations.ts";
import { useEffect, useRef, useState } from "react";
import { CAPP, CAPS, RAIL, RAILP } from "../content/acts.ts";
import type { Motion } from "../hooks/useMotion.ts";
import {
  HY,
  PATHS,
  paintFlow,
  paintStreak,
  type Pt,
  type Stage,
  type StageDef,
  type V4,
  type View,
} from "../stone/engine.ts";
import {
  clamp,
  CYAN,
  DEMO,
  DEP,
  DIAL,
  drawPrism,
  drawRings,
  drawSeal,
  easeOut,
  HOT,
  KEYN,
  lerp,
  lerpView,
  paintDeposit,
  part,
  pulseAt,
  sm,
  tag,
  VAULT,
} from "../stone/kit.ts";
import { redraw, useStage } from "../stone/useStage.ts";

/** Acts I to III as one stage, driven by a progress value p in [0, 1]. */
function theatre(
  getP: () => number,
  cine: () => boolean,
  fixed: boolean,
): StageDef {
  return {
    maxDpr: fixed ? 1.5 : 1.25,
    fixed,
    scene: (t, s: Stage) => {
      const p = getP();
      const narrow = s.cssW / s.cssH < 1.05;
      let V1: View = {
        pos: [-0.28, 1.45, 1.9],
        target: [-0.46, -0.05, -0.22],
        focal: 1.45,
      };
      let V2: View = {
        pos: [0.5, 1.3, 1.35],
        target: [0.12, -0.02, -0.14],
        focal: 1.4,
      };
      let V3: View = {
        pos: [0.02, 3.2, 2.45],
        target: [0.0, -0.15, 0.04],
        focal: 1.42,
      };
      if (narrow) {
        V1 = {
          pos: [-0.4, 2.3, 2.1],
          target: [-0.45, -0.05, -0.12],
          focal: 1.15,
        };
        V2 = {
          pos: [0.3, 2.0, 1.75],
          target: [0.12, -0.02, -0.1],
          focal: 1.15,
        };
        // Pull back for allocation on portrait screens so both payout destinations stay in view.
        V3 = {
          pos: [0.0, 4.4, 2.0],
          target: [0.0, -0.15, 0.05],
          focal: Math.min(1.2, (s.cssW / s.cssH) * 1.45),
        };
      }
      const [a, b, c] = [V1, V2, V3];
      const view =
        p < 0.34
          ? a
          : p < 0.46
            ? lerpView(a, b, sm(0.34, 0.46, p))
            : p < 0.66
              ? b
              : p < 0.78
                ? lerpView(b, c, sm(0.66, 0.78, p))
                : c;
      const amb =
        cine() && p > 0.34 && p < 0.6 ? pulseAt(t, 3, 1.8, 0.4) : null;
      const jp: V4 | null =
        p >= 0.76 && p < 0.9
          ? [
              DIAL[0],
              DIAL[1],
              lerp(0.05, 2.1, easeOut(sm(0.76, 0.9, p))),
              1 - sm(0.85, 0.9, p),
            ]
          : null;
      const c0 = DEMO[0];
      const ripple: V4 =
        p > 0.12 && p < 0.22
          ? [c0[0], c0[1], (p - 0.12) * 4.0, 1 - sm(0.15, 0.22, p)]
          : [0, 0, 0, 0];
      return {
        view,
        pulse: jp ?? amb ?? [0, 0, 0, 0],
        ripple,
        dial: sm(0.38, 0.58, p),
        ref: sm(0.58, 0.62, p),
        keyN: KEYN,
        beam: 0.1,
        exposure: 1.05,
      };
    },
    paint: (g) => {
      const p = getP();
      const f = clamp((p - 0.12) / 0.12, 0, 1);
      const MF = 0.2;
      if (f > 0) {
        const split = sm(0.78, 0.8, p);
        const heatFn = (pt: Pt) => {
          const u = pt[2];
          const age = (p - (0.12 + u * 0.12)) * 9;
          let h = age < 0 ? 0 : Math.exp(-age);
          if (split > 0)
            h =
              u > MF
                ? Math.max(h, 0.55 * Math.exp(-(p - 0.79) * 40) * split)
                : 0;
          return h;
        };
        if (split > 0) {
          paintStreak(
            g,
            part(DEMO, 0, Math.min(f, MF)),
            heatFn,
            1 - 0.72 * split,
            0.015,
          );
          if (f > MF) paintStreak(g, part(DEMO, MF, f), heatFn, 1, 0.015);
        } else paintStreak(g, part(DEMO, 0, f), heatFn, 1, 0.015);
      }
      paintDeposit(g, sm(0.18, 0.28, p) * (1 - sm(0.84, 0.97, p)));
      if (p > 0.82) {
        const s = ((p - 0.82) / 0.15) * 1.3;
        paintFlow(g, PATHS.toVault, s, 3, 0.08, 1);
        paintFlow(g, PATHS.toTrader, s, 9, 0.045, 0.55);
      }
    },
    overlay: (ctx, proj, t, P) => {
      const width = ctx.canvas.width / ctx.getTransform().a;
      beginAnnotations(
        ctx,
        fixed
          ? {}
          : {
              top: width < 600 ? 180 : 146,
              bottom:
                width < 600
                  ? Math.min(
                      230,
                      (ctx.canvas.height / ctx.getTransform().d) * 0.28,
                    )
                  : 64,
            },
      );
      const p = getP();
      const at = (x: number, z: number) => proj(x, HY, z);
      drawPrism(
        ctx,
        proj,
        DEMO[0],
        lerp(0.42, 0.0, sm(0.02, 0.12, p)),
        sm(0.0, 0.04, p) * (1 - sm(0.12, 0.17, p)),
        0.5 + p * 6,
      );
      drawRings(ctx, proj, DEP, sm(0.18, 0.28, p) * (1 - sm(0.9, 1, p)), t);
      drawSeal(
        ctx,
        proj,
        DEMO[14],
        lerp(0.6, 0.004, sm(0.66, 0.75, p)),
        sm(0.62, 0.68, p) * (1 - sm(0.9, 0.97, p)),
        sm(0.745, 0.755, p) * (1 - sm(0.78, 0.83, p)),
        0.3 + p * 2,
      );
      const refOn = (P.ref ?? 0) > 0.5;
      tag(ctx, at(DEMO[0][0], DEMO[0][1]), -30, 44, "Flagged swap", {
        alpha: sm(0.08, 0.12, p) * (1 - sm(0.32, 0.36, p)),
      });
      tag(ctx, at(DEP[0] - 0.1, DEP[1] + 0.05), -26, 46, "Deposit · $1,500", {
        alpha: sm(0.22, 0.27, p) * (1 - sm(0.74, 0.78, p)),
      });
      tag(
        ctx,
        at(DIAL[0], DIAL[1] - 0.5),
        30,
        -40,
        refOn ? "Signed price · P*" : "Awaiting signed price",
        {
          alpha: sm(0.3, 0.36, p) * (1 - sm(0.76, 0.8, p)),
          dot: refOn ? CYAN : null,
          color: refOn ? CYAN : null,
        },
      );
      const sp = sm(0.79, 0.83, p);
      tag(ctx, at(DEMO[7][0], DEMO[7][1]), -20, -44, "Margin · $100", {
        alpha: sp,
      });
      tag(
        ctx,
        at(DEMO[48][0], DEMO[48][1]),
        24,
        -42,
        "$400 excess × 80% = $320 retained",
        { alpha: sp, color: HOT },
      );
      const fin = sm(0.9, 0.95, p);
      tag(
        ctx,
        at(VAULT[0], VAULT[1] + 0.33),
        22,
        30,
        "LPs $283.50 · rebates $31.50 · tip $5",
        { alpha: fin, color: HOT },
      );
      tag(ctx, at(-1.5, 0.43), 20, 46, "Refund · $1,180", {
        alpha: fin,
      });
    },
  };
}

function Theatre({ viewportH }: { viewportH: number }) {
  const track = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const p = useRef(0);
  const [idx, setIdx] = useState({ cap: 0, rail: 0 });
  const stage = useStage(
    canvas,
    theatre(
      () => p.current,
      () => true,
      false,
    ),
    true,
  );

  useEffect(() => {
    let q = 0;
    const read = () => {
      q = 0;
      const el = track.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const span = Math.max(1, rect.height - window.innerHeight);
      const v = clamp(-rect.top / span, 0, 1);
      if (Math.abs(v - p.current) < 1e-4) return;
      p.current = v;
      redraw(stage);
      let cap = 0;
      let rail = 0;
      CAPP.forEach((x, i) => (v >= x ? (cap = i) : 0));
      RAILP.forEach((x, i) => (v >= x ? (rail = i) : 0));
      setIdx((o) => (o.cap === cap && o.rail === rail ? o : { cap, rail }));
    };
    const onScroll = () => {
      if (!q) q = requestAnimationFrame(read);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    read();
    return () => {
      window.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(q);
    };
  }, [stage]);

  const cap = CAPS[idx.cap];
  return (
    <div
      className="track"
      ref={track}
      style={{ height: Math.round(viewportH * 4.4) }}
    >
      <div className="sticky">
        <canvas className="stage-canvas" ref={canvas} aria-hidden="true" />
        <ol className="rail" aria-label="Settlement stages">
          {RAIL.map((label, i) => (
            <li
              key={label}
              className={i < idx.rail ? "done" : i === idx.rail ? "now" : ""}
            >
              <span className="k">0{i + 1}</span>
              <span>{label}</span>
            </li>
          ))}
        </ol>
        <div className="caption" aria-live="polite">
          <h3 className="h3">{cap.title}</h3>
          <p className="body">{cap.body}</p>
        </div>
      </div>
    </div>
  );
}

function Still({ at }: { at: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useStage(
    canvas,
    theatre(
      () => at,
      () => false,
      true,
    ),
    false,
  );
  return <canvas ref={canvas} aria-hidden="true" />;
}

export function Mechanism({ motion }: { motion: Motion }) {
  return (
    <section id="mechanism" className="act" aria-labelledby="mech-title">
      <div className="wrap act-head">
        <div className="stack">
          <h2 id="mech-title" className="h2">
            From a trade to <em>a fair settlement.</em>
          </h2>
        </div>
      </div>
      {motion.cine ? (
        <Theatre viewportH={motion.viewportH} />
      ) : (
        <div className="wrap frames">
          <figure className="frame">
            <div className="frame-box">
              <Still at={0.3} />
            </div>
            <figcaption>
              <h3 className="h3">The swap leaves a mark and a deposit.</h3>
              <p className="body">
                A flagged swap executes normally. In this worked example, a
                $500,000 trade posts a $1,500 refundable deposit.
              </p>
            </figcaption>
          </figure>
          <figure className="frame">
            <div className="frame-box">
              <Still at={0.62} />
            </div>
            <figcaption>
              <h3 className="h3">The record waits for a signed price.</h3>
              <p className="body">
                A signed Pyth price published at or after settlement time
                becomes the reference. Its confidence widens the margin.
              </p>
            </figcaption>
          </figure>
          <figure className="frame">
            <div className="frame-box">
              <Still at={0.93} />
            </div>
            <figcaption>
              <h3 className="h3">
                The excess is measured; the deposit splits.
              </h3>
              <p className="body">
                Of the $500 markout, $100 is margin. Touchstone retains $320 and
                refunds $1,180. The retained value funds a settlement tip,
                rebates and LPs.
              </p>
            </figcaption>
          </figure>
        </div>
      )}
    </section>
  );
}
