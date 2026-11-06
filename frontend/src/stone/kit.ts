// Shared pieces of the illustrated scenes: easing, the demo streak, the deposit receptacle and the overlay marks.
import { HY, LAYOUT, PATHS, paintStreak, sampleCubic, strokePath, wobble, type Curve, type Project, type Pt, type V2, type V3, type V4 } from "./engine.ts";

export const DIAL = LAYOUT.dial;
export const DEP = LAYOUT.deposit;
export const VAULT = LAYOUT.vault;
export const KEYN: V3 = [0.215, -0.763, -0.609];
export const KEYF: V3 = [0.1, -0.97, 0.22];
export const CYAN = "#5EF2E1";
export const HOT = "#FFD27A";
export const FROST = "#A9BACD";

export function clamp(x: number, a: number, b: number): number {
  return x < a ? a : x > b ? b : x;
}
/** Smoothstep from a to b. */
export function sm(a: number, b: number, x: number): number {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
export function easeOut(t: number): number {
  const c = clamp(t, 0, 1);
  return 1 - (1 - c) ** 3;
}

/** The page's 3 s pulse: a ring of light crossing the stone from the dial. Visual rhythm, not protocol timing. */
export function pulseAt(t: number, period: number, len: number, amp = 1): V4 {
  const ph = ((t % period) + period) % period;
  if (ph > len) return [DIAL[0], DIAL[1], 0, 0];
  const k = ph / len;
  return [DIAL[0], DIAL[1], 0.04 + easeOut(k) * 2.1, amp * (1 - sm(0.55, 1, k)) * sm(0, 0.03, k)];
}

/** The illustrative record's streak, with each point's position along it as the third coordinate. */
export const DEMO: Pt[] = wobble(sampleCubic(PATHS.demo, 72, 0, 1), 0.005, 2).map((p, i) => [p[0], p[1], i / 72]);

export function part(pts: Pt[], f0: number, f1: number): Pt[] {
  const n = pts.length - 1;
  const a = clamp(Math.floor(f0 * n), 0, n);
  const b = clamp(Math.ceil(f1 * n), 0, n);
  return pts.slice(a, b + 1);
}

/** Earlier records on the closing stone: solid where value moved, faint where the deposit was refunded. */
const HIST_CURVES: { p: Curve; solid: boolean }[] = [
  { p: [[-1.2, -0.58], [-1.06, -0.66], [-0.9, -0.64], [-0.8, -0.56]], solid: true },
  { p: [[0.66, -0.68], [0.8, -0.76], [0.98, -0.72], [1.1, -0.62]], solid: false },
  { p: [[-0.4, 0.58], [-0.22, 0.5], [0.0, 0.52], [0.16, 0.62]], solid: true },
  { p: [[0.4, 0.7], [0.54, 0.78], [0.7, 0.76], [0.8, 0.68]], solid: false },
  { p: [[1.18, -0.86], [1.28, -0.8], [1.4, -0.72], [1.48, -0.6]], solid: false },
  { p: [[-1.42, 0.64], [-1.28, 0.72], [-1.12, 0.76], [-0.98, 0.72]], solid: true },
];
export const HIST = HIST_CURVES.map((h, i) => ({ pts: wobble(sampleCubic(h.p, 40, 0, 1), 0.004, i * 1.7), solid: h.solid }));

/** The deposit held inside the engraved receptacle, painted into the stone. */
export function paintDeposit(g: CanvasRenderingContext2D, level: number): void {
  if (level <= 0.01) return;
  const a: V2 = [DEP[0] - 0.12, DEP[1]];
  const b: V2 = [DEP[0] - 0.12 + 0.24 * level, DEP[1]];
  strokePath(g, [a, b], "r", 0.75, 0.085);
  strokePath(g, [a, b], "g", 0.22, 0.07);
  strokePath(g, [a, b], "b", 0.05, 0.2);
}

export function streakAll(g: CanvasRenderingContext2D, strokes: { pts: Pt[]; last: number }[], t: number, hot: boolean): void {
  for (const st of strokes) {
    const ageEnd = t - st.last;
    const pres = ageEnd < 40 ? 1 : Math.max(0.3, 1 - ((ageEnd - 40) / 50) * 0.7);
    const heat = hot ? (pt: Pt) => {
      const age = t - pt[2];
      return age < 0 ? 1 : Math.exp(-age / 0.9) * 0.95;
    } : () => 0;
    paintStreak(g, st.pts, heat, pres, 0.013);
  }
}

function ringPts(proj: Project, cx: number, y: number, cz: number, r: number, n: number): V2[] {
  const out: V2[] = [];
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    const p = proj(cx + Math.cos(a) * r, y, cz + Math.sin(a) * r);
    if (p) out.push(p);
  }
  return out;
}

function polyline(ctx: CanvasRenderingContext2D, pts: V2[], close = false): void {
  if (pts.length < 2) return;
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  if (close) ctx.closePath();
  ctx.stroke();
}

export { tag } from "./annotations.ts";

/** The swap arriving: a small glass prism that lands on the stone. */
export function drawPrism(ctx: CanvasRenderingContext2D, proj: Project, at: Pt, h: number, a: number, spin: number): void {
  if (a <= 0.01) return;
  const cy = HY + 0.1 + h;
  const V: V3[] = [[0, 0.12, 0], [0, -0.1, 0]];
  for (let i = 0; i < 4; i++) {
    const an = spin + (i * Math.PI) / 2;
    V.push([Math.cos(an) * 0.085, 0, Math.sin(an) * 0.085]);
  }
  const P = V.map((v) => proj(at[0] + v[0], cy + v[1], at[1] + v[2]));
  if (P.some((p) => !p)) return;
  const Q = P as V2[];
  const sh = ringPts(proj, at[0], HY + 0.002, at[1], 0.07 * (1 + h * 1.5), 28);
  ctx.save();
  ctx.globalAlpha = a * (0.55 - Math.min(0.45, h * 0.5));
  ctx.fillStyle = "rgba(0,0,0,0.9)";
  ctx.beginPath();
  sh.forEach((p, k) => (k ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
  ctx.fill();
  ctx.restore();
  ctx.save();
  ctx.globalAlpha = a;
  const faces = [[0, 2, 3], [0, 3, 4], [0, 4, 5], [0, 5, 2], [1, 2, 3], [1, 3, 4], [1, 4, 5], [1, 5, 2]];
  faces.forEach((f, k) => {
    ctx.beginPath();
    ctx.moveTo(Q[f[0]][0], Q[f[0]][1]);
    ctx.lineTo(Q[f[1]][0], Q[f[1]][1]);
    ctx.lineTo(Q[f[2]][0], Q[f[2]][1]);
    ctx.closePath();
    ctx.fillStyle = k < 4 ? `rgba(243,239,231,${0.05 + (k % 2) * 0.05})` : "rgba(243,239,231,0.025)";
    ctx.fill();
    ctx.strokeStyle = "rgba(243,239,231,0.55)";
    ctx.lineWidth = 0.8;
    ctx.stroke();
  });
  ctx.strokeStyle = "rgba(255,210,122,0.9)";
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(Q[0][0], Q[0][1]);
  ctx.lineTo(Q[2][0], Q[2][1]);
  ctx.stroke();
  ctx.restore();
}

/** The judgment: an engraved seal that descends onto the record. */
export function drawSeal(ctx: CanvasRenderingContext2D, proj: Project, at: Pt, alt: number, a: number, flash: number, spin: number): void {
  if (a <= 0.01) return;
  const y = HY + alt;
  const K = 1.5;
  ctx.save();
  ctx.globalAlpha = a;
  ctx.lineWidth = 1;
  ctx.strokeStyle = "rgba(243,239,231,0.75)";
  polyline(ctx, ringPts(proj, at[0], y, at[1], 0.17 * K, 64));
  ctx.strokeStyle = "rgba(243,239,231,0.4)";
  polyline(ctx, ringPts(proj, at[0], y, at[1], 0.135 * K, 64));
  const poly: V2[] = [];
  for (let i = 0; i <= 12; i++) {
    const an = spin + (i / 12) * Math.PI * 2;
    const p = proj(at[0] + Math.cos(an) * 0.15 * K, y, at[1] + Math.sin(an) * 0.15 * K);
    if (p) poly.push(p);
  }
  ctx.strokeStyle = `rgba(232,180,74,${0.55 + flash * 0.45})`;
  ctx.lineWidth = 1 + flash;
  polyline(ctx, poly);
  for (let k = 0; k < 36; k++) {
    const b = spin * 0.5 + (k / 36) * Math.PI * 2;
    const outer = k % 3 ? 0.18 : 0.195;
    const p1 = proj(at[0] + Math.cos(b) * 0.17 * K, y, at[1] + Math.sin(b) * 0.17 * K);
    const p2 = proj(at[0] + Math.cos(b) * outer * K, y, at[1] + Math.sin(b) * outer * K);
    if (p1 && p2) {
      ctx.strokeStyle = "rgba(243,239,231,0.5)";
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.moveTo(p1[0], p1[1]);
      ctx.lineTo(p2[0], p2[1]);
      ctx.stroke();
    }
  }
  if (flash > 0) {
    ctx.strokeStyle = `rgba(255,210,122,${flash})`;
    ctx.lineWidth = 2;
    polyline(ctx, ringPts(proj, at[0], y, at[1], 0.06 * K, 40));
  }
  ctx.restore();
}

/** The held deposit: dashed rings turning around the receptacle. */
export function drawRings(ctx: CanvasRenderingContext2D, proj: Project, at: V2, a: number, t: number): void {
  if (a <= 0.01) return;
  ctx.save();
  ctx.globalAlpha = a;
  ctx.lineWidth = 1;
  ctx.strokeStyle = "rgba(232,180,74,0.55)";
  ctx.setLineDash([2, 5]);
  ctx.lineDashOffset = -t * 8;
  polyline(ctx, ringPts(proj, at[0], HY + 0.012, at[1], 0.3, 72));
  ctx.setLineDash([]);
  ctx.strokeStyle = "rgba(243,239,231,0.30)";
  polyline(ctx, ringPts(proj, at[0], HY + 0.012, at[1], 0.34, 72));
  ctx.restore();
}

/** A view interpolated between two camera views. */
export function lerpView(A: { pos: V3; target: V3; focal: number; shift?: V2 }, B: { pos: V3; target: V3; focal: number; shift?: V2 }, t: number) {
  const l3 = (a: V3, b: V3): V3 => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
  const sa = A.shift ?? [0, 0];
  const sb = B.shift ?? [0, 0];
  return { pos: l3(A.pos, B.pos), target: l3(A.target, B.target), focal: lerp(A.focal, B.focal, t), shift: [lerp(sa[0], sb[0], t), lerp(sa[1], sb[1], t)] as V2 };
}
