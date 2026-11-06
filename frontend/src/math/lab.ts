// The settlement laboratory: one record through DepositLib and SettlementMath, in USDC base units (6 decimals).
import { alphaBps, benign, clawback, conserves, MODE_CLOSED, MODE_CONTINUOUS, quoteAmount, rateBps, splitRetained, type Payout } from "./settlement.ts";

export type Licence = "none" | "holder" | "other";
export type ParamKey =
  | "feeBps" | "delta" | "deltaMax" | "beta" | "deltaC" | "eps" | "conf" | "alpha" | "alphaLic" | "alphaC" | "epsC"
  | "tipBps" | "tipCap" | "protoBps" | "rhoBps" | "kappa" | "pool";

export interface ParamField {
  k: ParamKey;
  label: string;
  d: number;
  min: number;
  max: number;
}

/** The research report's worked-example parameters (spec §4.7). Closure ε and α_c come from its weekend example. */
export const PARAMS: ParamField[] = [
  { k: "feeBps", label: "LP fee f (bps)", d: 5, min: 0, max: 100 },
  { k: "delta", label: "δ floor (bps)", d: 30, min: 0, max: 2000 },
  { k: "deltaMax", label: "δmax cap (bps)", d: 300, min: 0, max: 5000 },
  { k: "beta", label: "β gap multiplier", d: 1.25, min: 0, max: 10 },
  { k: "deltaC", label: "δc closure (bps)", d: 300, min: 0, max: 5000 },
  { k: "eps", label: "ε margin (bps)", d: 2, min: 0, max: 500 },
  { k: "conf", label: "c* confidence (bps)", d: 0, min: 0, max: 200 },
  { k: "alpha", label: "α (%)", d: 80, min: 0, max: 100 },
  { k: "alphaLic", label: "α_lic (%)", d: 95, min: 0, max: 100 },
  { k: "alphaC", label: "α_c closure (%)", d: 50, min: 0, max: 100 },
  { k: "epsC", label: "ε closure (bps)", d: 50, min: 0, max: 500 },
  { k: "tipBps", label: "Tip (bps of R)", d: 200, min: 0, max: 2000 },
  { k: "tipCap", label: "Tip cap ($)", d: 5, min: 0, max: 1000 },
  { k: "protoBps", label: "Protocol share (bps)", d: 0, min: 0, max: 5000 },
  { k: "rhoBps", label: "ρ to rebate pool (bps)", d: 1000, min: 0, max: 5000 },
  { k: "kappa", label: "κ rebate (bps of fee)", d: 4000, min: 0, max: 9000 },
  { k: "pool", label: "Rebate pool ($)", d: 1000, min: 0, max: 10_000_000 },
];

export type Params = Record<ParamKey, string>;

export function defaultParams(): Params {
  return Object.fromEntries(PARAMS.map((f) => [f.k, String(f.d)])) as Params;
}

export interface Preset {
  id: string;
  label: string;
  N: number;
  mBps: number;
  gap: number;
  closed: boolean;
  lic: Licence;
  inBand: boolean;
}

export const PRESETS: Preset[] = [
  { id: "arb", label: "Arbitrage · $500k", N: 500_000, mBps: 10, gap: 0, closed: false, lic: "none", inBand: true },
  { id: "benign", label: "Benign · $200k", N: 200_000, mBps: -1, gap: 0, closed: false, lic: "none", inBand: true },
  { id: "retail", label: "Retail · $20k", N: 20_000, mBps: -1.5, gap: 0, closed: false, lic: "none", inBand: true },
  { id: "outsider", label: "Outsider, lease live", N: 500_000, mBps: 10, gap: 0, closed: false, lic: "other", inBand: true },
  { id: "holder", label: "Licence holder", N: 500_000, mBps: 10, gap: 0, closed: false, lic: "holder", inBand: true },
  { id: "closure", label: "Closure record", N: 200_000, mBps: 30, gap: 0, closed: true, lic: "none", inBand: true },
];

export interface LabInput {
  N: number;
  mBps: number;
  gap: number;
  closed: boolean;
  lic: Licence;
  inBand: boolean;
  params: Params;
}

/** adverse: R > 0. benign: R = 0 and m <= 0, rebate paid. exempt: R = 0 with m > 0 (inside the margin, or alpha = 0). */
export type LabPath = "adverse" | "benign" | "exempt";

export interface LabOutput {
  P: Record<ParamKey, number>;
  N: bigint;
  m: bigint;
  rate: bigint;
  D: bigint;
  alpha: bigint;
  eps: number;
  margin: bigint;
  R: bigint;
  excess: bigint;
  path: LabPath;
  pay: Payout;
  ok: boolean;
  rateWhy: string;
  regime: string;
  pool: bigint;
  /** Effective fee in bps: f + R/N. */
  eff: number;
}

const UNIT = 1_000_000n;

function num(raw: string, f: ParamField): number {
  const v = Number.parseFloat(raw);
  const x = Number.isFinite(v) ? v : f.d;
  return Math.min(f.max, Math.max(f.min, x));
}

const big = (x: number): bigint => BigInt(Math.round(x));

export function computeLab(s: LabInput): LabOutput {
  const P = Object.fromEntries(PARAMS.map((f) => [f.k, num(s.params[f.k], f)])) as Record<ParamKey, number>;
  const N = BigInt(Math.max(1, Math.round(s.N))) * UNIT;
  // m = N * mBps / 1e4, with mBps carried to two decimals.
  const m = (N * big(s.mBps * 100)) / 1_000_000n;
  const mode = s.closed ? MODE_CLOSED : MODE_CONTINUOUS;
  const lic = s.lic !== "none";
  const holder = s.lic === "holder";
  const betaX100 = big(P.beta * 100);
  const rate = rateBps(mode, big(s.gap), big(P.delta), big(P.deltaMax), betaX100, big(P.deltaC));
  const D = quoteAmount(N, rate);
  const alpha = alphaBps(mode, lic, holder, s.inBand, big(P.alpha * 100), big(P.alphaLic * 100), big(P.alphaC * 100));
  const eps = Math.round(s.closed ? P.epsC : P.eps);
  const conf = Math.round(P.conf);
  const margin = (N * BigInt(eps + conf)) / 10_000n;
  const R = clawback(D, m, N, BigInt(eps), BigInt(conf), alpha);
  const excess = m - margin;
  const tipCap = big(P.tipCap * 1e6);
  const pool = big(P.pool) * UNIT;
  let path: LabPath;
  let pay: Payout;
  if (R > 0n) {
    path = "adverse";
    pay = splitRetained(D, R, { tipBps: big(P.tipBps), tipCap, protocolShareBps: big(P.protoBps), rhoBps: big(P.rhoBps) });
  } else if (m <= 0n) {
    // Benign only when R = 0 and m <= 0 (spec §8, Settler._payout); a positive markout inside the margin
    // is refunded in full without a rebate.
    path = "benign";
    pay = benign(D, N, big(P.feeBps * 100), big(P.kappa), pool, big(P.tipBps), tipCap);
  } else {
    path = "exempt";
    pay = { benign: false, refund: D, tip: 0n, toProtocol: 0n, toRebatePool: 0n, toLPs: 0n, rebate: 0n };
  }
  const ok = path === "adverse" ? conserves(pay, D, 0n) : path === "benign" ? conserves(pay, D, pool) : pay.refund === D;
  const scaled = Math.floor((Number(betaX100) * Math.max(0, Math.round(s.gap))) / 100);
  const rateWhy = s.closed
    ? "δc, closure record"
    : Number(rate) === Math.round(P.deltaMax) && scaled >= P.deltaMax
      ? "δmax cap"
      : scaled > P.delta
        ? "β·g⁺"
        : "δ floor";
  const regime = s.closed ? "closure record" : !lic ? "no lease" : !s.inBand ? "lease live, outside band" : holder ? "holder’s first swap" : "lease live, other trader";
  return { P, N, m, rate, D, alpha, eps, margin, R, excess, path, pay, ok, rateWhy, regime, pool, eff: P.feeBps + (Number(R) / Number(N)) * 1e4 };
}
