import { ActionLink } from "@/components/ActionLink";
import { useRef } from "react";
import type { Motion } from "../hooks/useMotion.ts";
import { engine, paintStreak } from "../stone/engine.ts";
import {
  DEMO,
  DIAL,
  easeOut,
  HIST,
  KEYN,
  pulseAt,
  sm,
  streakAll,
} from "../stone/kit.ts";
import { useStage } from "../stone/useStage.ts";

export function Closing({ motion, marks }: { motion: Motion; marks: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const r = useRef({ seen: null as number | null, still: !motion.cine });
  r.current.still = !motion.cine;
  useStage(
    canvas,
    {
      maxDpr: 1.25,
      scene: (t, s) => {
        const narrow = s.cssW / s.cssH < 1.3;
        if (r.current.seen === null && !r.current.still) r.current.seen = t;
        const rev = t - (r.current.seen ?? 0);
        const pulse = r.current.still
          ? ([DIAL[0], DIAL[1], 1.25, 0.8] as [number, number, number, number])
          : rev < 2.6
            ? ([
                DIAL[0],
                DIAL[1],
                0.04 + easeOut(rev / 2.6) * 2.5,
                1 - sm(2.0, 2.6, rev),
              ] as [number, number, number, number])
            : pulseAt(t, 3, 1.8, 0.55);
        return {
          view: {
            pos: [0, 4.6, 1.15],
            target: [0, -0.1, 0.0],
            focal: narrow ? 1.15 : 1.9,
          },
          pulse,
          keyN: KEYN,
          exposure: 1.05,
          beam: 0.06,
        };
      },
      paint: (g, t) => {
        for (const h of HIST)
          paintStreak(g, h.pts, () => 0, h.solid ? 1 : 0.28, 0.014);
        paintStreak(g, DEMO, () => 0, 1, 0.015);
        streakAll(g, engine().userStrokes, t, false);
      },
    },
    motion.cine,
  );
  return (
    <section id="end" className="closing" aria-labelledby="end-title">
      <div className="closing-copy">
        <h2 id="end-title" className="h-display">
          Value, measured<span className="gold">.</span>
        </h2>
        <div
          className="cta-row"
          style={{ justifyContent: "center", marginTop: 8 }}
        >
          <ActionLink variant="default" href="#lab">
            Run the laboratory
          </ActionLink>
          <ActionLink href="#/swap">Swap on the testnet</ActionLink>
        </div>
      </div>
      <div className="closing-stage">
        <canvas ref={canvas} aria-hidden="true" />
      </div>
      <p
        className="tl"
        style={{ textAlign: "center", padding: "0 var(--gut)" }}
      >
        {marks > 0
          ? `The stone keeps the ${marks} ${marks === 1 ? "mark" : "marks"} you drew in the opening, solid gold while fresh, fading to traces.`
          : "Marks you draw on the opening stone are kept here, beside the record’s own."}
      </p>
    </section>
  );
}
