import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "@/components/ui/accordion";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import type { Live } from "../chain/useLive.ts";
import { LAB_STEPS } from "../content/acts.ts";
import { usd } from "../format.ts";
import type { Motion } from "../hooks/useMotion.ts";
import {
  computeLab,
  defaultParams,
  PARAMS,
  PRESETS,
  type LabInput,
  type LabOutput,
  type Licence,
  type Params,
} from "../math/lab.ts";
import {
  engine,
  HY,
  PATHS,
  paintFlow,
  paintStreak,
  type V4,
} from "../stone/engine.ts";
import {
  clamp,
  DEMO,
  DEP,
  DIAL,
  easeOut,
  HOT,
  KEYN,
  lerp,
  paintDeposit,
  part,
  pulseAt,
  sm,
  tag,
  VAULT,
} from "../stone/kit.ts";
import { redraw, useStage } from "../stone/useStage.ts";

const STEP_MS = 430;
const pctText = (bps: bigint) =>
  `${(Number(bps) / 100).toFixed(bps % 100n ? 2 : 0)}%`;

interface Bar {
  cls: string;
  w: string;
  label: string;
}

function bars(o: LabOutput, held: boolean): Bar[] {
  const D = o.D > 0n ? o.D : 1n;
  const w = (x: bigint) =>
    `${(Number((x * 1_000_000n) / D) / 10_000).toFixed(3)}%`;
  const p = o.pay;
  if (held)
    return [
      { cls: "sw-held", w: "100%", label: "Held as deposit until settlement" },
    ];
  if (o.path === "adverse") {
    return [
      { cls: "sw-refund", w: w(p.refund), label: `Refund ${usd(p.refund)}` },
      { cls: "sw-tip", w: w(p.tip), label: `Tip ${usd(p.tip)}` },
      {
        cls: "sw-proto",
        w: w(p.toProtocol),
        label: `Protocol ${usd(p.toProtocol)}`,
      },
      {
        cls: "sw-pool",
        w: w(p.toRebatePool),
        label: `Rebate pool ${usd(p.toRebatePool)}`,
      },
      { cls: "sw-lps", w: w(p.toLPs), label: `LPs, vested ${usd(p.toLPs)}` },
    ];
  }
  const out: Bar[] = [
    { cls: "sw-refund", w: "100%", label: `Refund in full ${usd(p.refund)}` },
  ];
  if (o.path === "benign")
    out.push({
      cls: "sw-rebate",
      w: "0%",
      label: `Plus a rebate from the pool ${usd(p.rebate)}`,
    });
  return out;
}

function rows(o: LabOutput): { k: string; v: string; em?: boolean }[] {
  const p = o.pay;
  const base = [
    { k: `Deposit rate · ${o.rateWhy}`, v: `${o.rate} bps` },
    { k: "Deposit D", v: usd(o.D) },
    { k: "Markout m⁺", v: usd(o.m) },
    { k: `Margin (ε + c*) · N⁺ · ε ${o.eps} bps`, v: usd(o.margin) },
    { k: "Excess over the margin", v: usd(o.excess > 0n ? o.excess : 0n) },
    { k: `α · ${o.regime}`, v: pctText(o.alpha) },
    { k: "Retained R = min(D, α · excess)", v: usd(o.R), em: true },
    { k: "Refund → beneficiary", v: usd(p.refund) },
  ];
  const holds = o.ok ? "holds" : "fails";
  if (o.path === "adverse") {
    return base.concat([
      { k: "Tip → settlement caller", v: usd(p.tip) },
      { k: "Protocol share", v: usd(p.toProtocol) },
      { k: "Rebate pool (ρ)", v: usd(p.toRebatePool) },
      { k: "LPs, vested", v: usd(p.toLPs), em: true },
      { k: "Effective fee f + R/N", v: `${o.eff.toFixed(2)} bps` },
      { k: "Conservation: refund + splits = D", v: holds },
    ]);
  }
  if (o.path === "benign") {
    return base.concat([
      { k: "Rebate gross min(κ·f·N, pool)", v: usd(p.rebate + p.tip) },
      { k: "Tip from the rebate", v: usd(p.tip) },
      { k: "Rebate → rebateTo", v: usd(p.rebate), em: true },
      { k: "Conservation: tip + rebate ≤ pool", v: holds },
    ]);
  }
  return base.concat([
    {
      k: o.alpha === 0n ? "Licence exemption" : "Inside the margin",
      v: o.alpha === 0n ? "α = 0" : "R = 0, m > 0",
    },
  ]);
}

function sentence(o: LabOutput): string {
  const p = o.pay;
  const a = pctText(o.alpha);
  if (o.path === "adverse") {
    return `The swap beat P* by ${usd(o.m)}. After the ${usd(o.margin)} margin, ${a} of the ${usd(o.excess)} excess, ${usd(o.R)}, is retained${o.R === o.D ? ", capped at the deposit" : ""}. ${usd(p.refund)} of the ${usd(o.D)} deposit returns to the trader, and LPs receive ${usd(p.toLPs)} over the vesting period.`;
  }
  if (o.path === "benign") {
    return `The swap did not beat P* (markout ${usd(o.m)}), so the record is benign: nothing is retained, the full ${usd(o.D)} deposit is refunded, and ${usd(p.rebate)} is paid from the rebate pool to rebateTo.`;
  }
  if (o.alpha === 0n)
    return `The licence holder’s first swap in the block, inside band G: α = 0, so nothing is retained and the full ${usd(o.D)} deposit is refunded, although the swap beat P* by ${usd(o.m)}. No rebate: the markout is positive.`;
  return `The ${usd(o.m)} markout sits inside the ${usd(o.margin)} margin, so nothing is retained and the full ${usd(o.D)} deposit is refunded. There is no rebate, because a record is benign only when its markout is at most zero.`;
}

/** The deployed pool's parameters, in the laboratory's units. */
function deployedParams(live: Live, current: Params): Params | null {
  const s = live.snapshot;
  if (!s) return null;
  const c = s.config;
  return {
    ...current,
    feeBps: String(s.lpFee / 100),
    delta: String(c.deltaBps),
    deltaMax: String(c.deltaMaxBps),
    beta: String(c.betaX100 / 100),
    deltaC: String(c.deltaClosedBps),
    eps: String(c.epsBps),
    alpha: String(c.alphaBps / 100),
    alphaLic: String(c.alphaLicensedBps / 100),
    alphaC: String(c.alphaClosedBps / 100),
    epsC: String(c.epsClosedBps),
    tipBps: String(c.tipBps),
    tipCap: String(Number(c.tipCap) / 1e6),
    protoBps: String(c.protocolShareBps),
    rhoBps: String(c.rhoBps),
    kappa: String(c.kappaBps),
  };
}

type LabState = Omit<LabInput, "params"> & {
  preset: string | null;
  params: Params;
  source: "report" | "deployed";
};

function fromPreset(
  id: string,
  params: Params,
  source: LabState["source"],
): LabState {
  const p = PRESETS.find((x) => x.id === id) ?? PRESETS[0];
  return {
    preset: p.id,
    N: p.N,
    mBps: p.mBps,
    gap: p.gap,
    closed: p.closed,
    lic: p.lic,
    inBand: p.inBand,
    params,
    source,
  };
}

export function Lab({ motion, live }: { motion: Motion; live: Live }) {
  const [s, setS] = useState<LabState>(() =>
    fromPreset("arb", defaultParams(), "report"),
  );
  const [step, setStep] = useState(-1);
  const out = useMemo(() => computeLab(s), [s]);
  const canvas = useRef<HTMLCanvasElement>(null);
  const r = useRef({
    out,
    step,
    mBps: s.mBps,
    t0: 0,
    still: !motion.cine,
    timers: [] as ReturnType<typeof setTimeout>[],
  });
  r.current.out = out;
  r.current.step = step;
  r.current.mBps = s.mBps;
  r.current.still = !motion.cine;

  const stage = useStage(
    canvas,
    {
      maxDpr: 1.5,
      scene: (t, st) => {
        const k = r.current.step;
        const narrow = st.cssW / st.cssH < 1.2;
        const ph = (t - r.current.t0) / (STEP_MS / 1000);
        const jp: V4 =
          k === 4
            ? [
                DIAL[0],
                DIAL[1],
                lerp(0.05, 2.1, easeOut(clamp(ph - 4, 0, 1))),
                1 - sm(0.7, 1, ph - 4),
              ]
            : !r.current.still && k < 0
              ? pulseAt(t, 3, 1.8, 0.35)
              : [0, 0, 0, 0];
        return {
          view: {
            pos: [0, 4.0, 1.6],
            target: [0, -0.12, 0.06],
            focal: narrow ? 1.45 : 1.85,
          },
          pulse: jp,
          ref: k >= 3 || k < 0 ? 1 : 0,
          dial: k === 2 ? clamp(ph - 2, 0, 1) : k > 2 || k < 0 ? 1 : 0,
          keyN: KEYN,
          exposure: 1.05,
          beam: 0.1,
        };
      },
      paint: (g, t) => {
        const { out: o, step: k, mBps } = r.current;
        const idle = k < 0;
        const mpos = o.m > 0n;
        const f = mpos ? clamp(mBps / 15, 0.08, 1) : 0.12;
        const MF = mpos ? clamp(Number(o.margin) / Number(o.m), 0, 1) : 1;
        const judged = idle || k >= 4;
        const ph = (t - r.current.t0) / (STEP_MS / 1000);
        const heatAll = k === 0 ? 0.9 : k === 1 ? 0.4 : 0.06;
        const heatFn = () => heatAll;
        const pts = part(DEMO, 0, f);
        if (judged && mpos) {
          paintStreak(g, part(pts, 0, Math.min(1, MF)), heatFn, 0.3, 0.015);
          if (MF < 1) paintStreak(g, part(pts, MF, 1), heatFn, 1, 0.015);
        } else paintStreak(g, pts, heatFn, mpos ? 1 : 0.35, 0.015);
        paintDeposit(
          g,
          idle ? 0 : k >= 1 && k < 5 ? 1 : k >= 5 ? 1 - clamp(ph - 5, 0, 1) : 0,
        );
        if (k >= 5) {
          const sp = clamp(ph - 5, 0, 1.4) * 1.1;
          const D = Number(o.D) || 1;
          const nv =
            o.R > 0n ? Math.max(1, Math.round((12 * Number(o.R)) / D)) : 0;
          if (nv) paintFlow(g, PATHS.toVault, sp, nv, 0.06, 1);
          paintFlow(g, PATHS.toTrader, sp, 12 - nv, 0.045, 0.55);
        }
      },
      overlay: (ctx, proj) => {
        const { out: o, step: k } = r.current;
        const idle = k < 0;
        const at = (x: number, z: number) => proj(x, HY, z);
        tag(ctx, at(DEP[0], DEP[1] + 0.07), -10, 40, `Deposit · ${usd(o.D)}`, {
          alpha: idle || k >= 1 ? 1 : 0,
        });
        if (idle || k >= 4) {
          tag(
            ctx,
            at(VAULT[0], VAULT[1] + 0.33),
            -10,
            36,
            `Retained · ${usd(o.R)}`,
            {
              color: o.R > 0n ? HOT : null,
            },
          );
          tag(
            ctx,
            at(DEMO[2][0], DEMO[2][1]),
            -14,
            -34,
            o.m > 0n
              ? `Markout ${usd(o.m)} · margin ${usd(o.margin)}`
              : `Markout ${usd(o.m)} · no excess`,
          );
        }
      },
    },
    motion.cine,
  );

  useEffect(() => redraw(stage), [out, step, stage]);
  useEffect(() => () => r.current.timers.forEach(clearTimeout), []);

  const clearTimers = () => {
    r.current.timers.forEach(clearTimeout);
    r.current.timers = [];
  };
  const edit = (patch: Partial<LabState>) => {
    clearTimers();
    setStep(-1);
    setS((o) => ({ ...o, preset: null, ...patch }));
  };
  const run = () => {
    clearTimers();
    r.current.t0 = engine().now();
    setStep(0);
    if (stage.current) stage.current.animating = true;
    for (let i = 1; i <= 6; i++) {
      r.current.timers.push(
        setTimeout(
          () => {
            setStep(i);
            if (i === 6) {
              r.current.timers.push(
                setTimeout(() => {
                  if (stage.current) {
                    stage.current.animating = !r.current.still;
                    redraw(stage);
                  }
                }, 1400),
              );
            }
          },
          motion.reduced ? 0 : i * STEP_MS,
        ),
      );
    }
  };

  const held = step >= 0 && step < 5;
  const bs = bars(out, held);
  const deployed = deployedParams(live, s.params);
  const pathLabel =
    out.path === "adverse"
      ? "Adverse path · value retained"
      : out.path === "benign"
        ? "Benign path · full refund and rebate"
        : out.alpha === 0n
          ? "Licence exemption · full refund"
          : "Inside the margin · full refund";

  return (
    <section id="lab" className="act" aria-labelledby="lab-title">
      <div className="wrap act-head">
        <div className="stack">
          <h2 id="lab-title" className="h2">
            The settlement <em>laboratory.</em>
          </h2>
        </div>
      </div>
      <div className="wrap lab">
        <form
          className="inst"
          onSubmit={(e) => e.preventDefault()}
          aria-label="Settlement inputs"
        >
          <fieldset>
            <legend>Examples</legend>
            <ToggleGroup
              className="presets"
              value={s.preset ? [s.preset] : []}
              onValueChange={(v) => {
                if (v[0]) {
                  clearTimers();
                  setStep(-1);
                  setS((o) => fromPreset(String(v[0]), o.params, o.source));
                }
              }}
            >
              {PRESETS.map((p) => (
                <ToggleGroupItem key={p.id} value={p.id} className="opt">
                  {p.label}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </fieldset>
          <fieldset>
            <legend>Trade</legend>
            <div className="field">
              <label id="lab-n-label" htmlFor="lab-n">
                Notional N
              </label>
              <span className="val">${s.N.toLocaleString("en-US")}</span>
              <Slider
                id="lab-n"
                aria-labelledby="lab-n-label"
                min={1000}
                max={2000000}
                step={1000}
                value={[s.N]}
                onValueChange={(v) =>
                  edit({ N: Number(Array.isArray(v) ? v[0] : v) })
                }
              />
            </div>
            <div className="field">
              <label id="lab-m-label" htmlFor="lab-m">
                Markout of the in-the-money leg, m⁺
              </label>
              <span className="val">
                {s.mBps > 0 ? "+" : ""}
                {s.mBps} bps · {usd(out.m)}
              </span>
              <Slider
                id="lab-m"
                aria-labelledby="lab-m-label"
                min={-20}
                max={60}
                step={0.5}
                value={[s.mBps]}
                onValueChange={(v) =>
                  edit({ mBps: Number(Array.isArray(v) ? v[0] : v) })
                }
              />
              <span className="hint">
                In bps of N against P*, net of the LP fee. Assumes no overshoot
                past P*, so N⁺ = N and m = m⁺.
              </span>
            </div>
            <div className="field">
              <label id="lab-g-label" htmlFor="lab-g">
                Pre-swap gap toward the reference, g
              </label>
              <span className="val">{s.gap} bps</span>
              <Slider
                id="lab-g"
                aria-labelledby="lab-g-label"
                min={-50}
                max={300}
                step={5}
                value={[s.gap]}
                onValueChange={(v) =>
                  edit({ gap: Number(Array.isArray(v) ? v[0] : v) })
                }
              />
            </div>
          </fieldset>
          <fieldset>
            <legend>Regime</legend>
            <ToggleGroup
              className="seg"
              aria-label="Market regime"
              value={[s.closed ? "closed" : "continuous"]}
              onValueChange={(v) => {
                if (v[0]) edit({ closed: v[0] === "closed" });
              }}
            >
              <ToggleGroupItem value="continuous" className="opt">
                Continuous
              </ToggleGroupItem>
              <ToggleGroupItem value="closed" className="opt">
                Closure record
              </ToggleGroupItem>
            </ToggleGroup>
            <ToggleGroup
              className="seg lease-options"
              aria-label="Licence regime"
              value={[s.lic]}
              onValueChange={(v) => {
                if (v[0]) edit({ lic: v[0] as Licence });
              }}
            >
              <ToggleGroupItem value="none" className="opt">
                No lease
              </ToggleGroupItem>
              <ToggleGroupItem value="holder" className="opt">
                Licence holder
              </ToggleGroupItem>
              <ToggleGroupItem value="other" className="opt">
                Other trader
              </ToggleGroupItem>
            </ToggleGroup>
            <label className="check">
              <Checkbox
                checked={s.inBand}
                onCheckedChange={(checked) =>
                  edit({ inBand: checked === true })
                }
              />
              Pool price inside band G of P*
            </label>
          </fieldset>
          <Accordion className="params">
            <AccordionItem value="parameters">
              <AccordionTrigger>Parameters</AccordionTrigger>
              <AccordionContent>
                <div className="pgrid">
                  {PARAMS.map((f) => (
                    <label key={f.k}>
                      {f.label}
                      <Input
                        type="text"
                        inputMode="decimal"
                        spellCheck={false}
                        autoComplete="off"
                        value={s.params[f.k]}
                        onChange={(e) =>
                          edit({
                            params: { ...s.params, [f.k]: e.target.value },
                            source: "report",
                          })
                        }
                      />
                    </label>
                  ))}
                </div>
                <div className="run" style={{ marginTop: 14 }}>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={!deployed}
                    onClick={() =>
                      deployed && edit({ params: deployed, source: "deployed" })
                    }
                  >
                    Use the deployed pool’s parameters
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() =>
                      edit({ params: defaultParams(), source: "report" })
                    }
                  >
                    Worked-example defaults
                  </Button>
                </div>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
          <div className="run">
            <Button type="button" onClick={run}>
              Run settlement
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                clearTimers();
                setStep(-1);
                setS(fromPreset("arb", defaultParams(), "report"));
              }}
            >
              Reset
            </Button>
          </div>
        </form>
        <div className="labv">
          <div className="lab-stage">
            <canvas ref={canvas} aria-hidden="true" />
            <Badge variant="outline" className="chip chip-illu">
              Simulation · no funds moved
            </Badge>
          </div>
          <ol className="steps" aria-label="Simulation steps">
            {LAB_STEPS.map((l, i) => (
              <li
                key={l}
                className={
                  step < 0 ? "" : i < step ? "done" : i === step ? "now" : ""
                }
              >
                {l}
              </li>
            ))}
          </ol>
          <div className="assay">
            <p className="tl">Deposit D = {usd(out.D)} · how it settles</p>
            <div
              className="bar"
              role="img"
              aria-label={bs.map((b) => b.label).join(", ")}
            >
              {bs.map((b) => (
                <span
                  key={b.cls}
                  className={`seg-b ${b.cls}`}
                  style={{ width: b.w }}
                />
              ))}
            </div>
            <ul className="legend">
              {bs.map((b) => (
                <li key={b.cls}>
                  <i className={b.cls} />
                  {b.label}
                </li>
              ))}
            </ul>
          </div>
          <div className="ledger">
            {rows(out).map((row) => (
              <Fragment key={row.k}>
                <div>{row.k}</div>
                <div className={`v ${row.em ? "em" : ""}`}>{row.v}</div>
              </Fragment>
            ))}
          </div>
          <div className="outcome" aria-live="polite">
            <h3>{pathLabel}</h3>
            <p className="body" style={{ marginTop: 10 }}>
              {sentence(out)}
            </p>
          </div>
          <Accordion>
            <AccordionItem value="assumptions">
              <AccordionTrigger>Example assumptions</AccordionTrigger>
              <AccordionContent>
                <p className="src">
                  Defaults: f 5 bps · δ 30 · δmax 300 · β 1.25 · ε 2 · α 80% ·
                  α_lic 95% · tip 2% capped at $5 · ρ 10% · κ 40%, the research
                  report’s worked example. Closure ε 50 bps and α_c 50% come
                  from its weekend noise-tax example. A record is benign, and
                  earns a rebate, only when R = 0 and m ≤ 0 (spec §8,
                  Settler._payout).
                </p>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </div>
      </div>
    </section>
  );
}
