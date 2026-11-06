// The hook's swap-time arithmetic, reproduced for display next to its own previewDeposit answer. Every function
// mirrors one contract routine so a presenter can point at each number; when the two disagree, the hook governs.

import type { Side } from "./swap.ts";

const BPS = 10_000n;
const PIPS = 1_000_000n;
const Q96 = 1n << 96n;

/** TriggerLib's bits (contracts/src/libraries/TriggerLib.sol). */
export const TRIGGERS = [
  { bit: 1, name: "First touch", detail: "first swap of at least N₀ in its block" },
  { bit: 2, name: "Flow", detail: "the direction's bucket reached N_min" },
  { bit: 4, name: "Drift", detail: "trading toward a reference at least τ away" },
  { bit: 8, name: "Closed market", detail: "the reference market is closed" },
] as const;

export function firedTriggers(mask: number): string[] {
  return TRIGGERS.filter((t) => (mask & t.bit) !== 0).map((t) => t.name);
}

/**
 * PriceLib.signedGapBps: B * s * (P_ref - p_pre) / P_ref, truncated toward zero, where s is +1 for buying the risky
 * token. Positive means the trade moves the pool toward the reference. Prices share one scale.
 */
export function signedGapBps(referenceE6: bigint, poolE6: bigint, side: Side): bigint {
  if (referenceE6 <= 0n) throw new Error("reference price must be positive");
  const raw = ((referenceE6 - poolE6) * BPS) / referenceE6;
  return side === "buy" ? raw : -raw;
}

export interface RateTerms {
  deltaBps: number;
  deltaMaxBps: number;
  betaX100: number;
}

/** DepositLib's continuous rate: min(deltaMax, max(delta, floor(beta * max(g, 0)))). */
export function continuousRateBps(gapBps: bigint, t: RateTerms): bigint {
  const scaled = (BigInt(t.betaX100) * (gapBps > 0n ? gapBps : 0n)) / 100n;
  const floor = BigInt(t.deltaBps);
  const cap = BigInt(t.deltaMaxBps);
  const rate = scaled > floor ? scaled : floor;
  return rate < cap ? rate : cap;
}

/** D_q = floor(N * rate / B), in quote base units. */
export function quoteDeposit(notionalQuote: bigint, rateBps: bigint): bigint {
  return (notionalQuote * rateBps) / BPS;
}

function sqrtBig(n: bigint): bigint {
  if (n < 0n) throw new Error("square root of a negative number");
  if (n < 2n) return n;
  let x = n;
  let y = (x + 1n) >> 1n;
  while (y < x) {
    x = y;
    y = (x + n / x) >> 1n;
  }
  return x;
}

/**
 * The v4 sqrt price for a quote-per-risky price with 6 implied decimals. The pool's raw price is currency1 per
 * currency0 in base units; when quote is currency0 that is the reciprocal of quote per risky.
 */
export function sqrtPriceX96At(priceE6: bigint, quoteIs0: boolean, riskyDecimals: number, quoteDecimals: number): bigint {
  if (priceE6 <= 0n) throw new Error("price must be positive");
  // quote base units per risky base unit = priceE6 * 10^(dq - 6) / 10^dr
  const num = priceE6 * 10n ** BigInt(quoteDecimals);
  const den = 10n ** BigInt(riskyDecimals + 6);
  return quoteIs0 ? sqrtBig((den << 192n) / num) : sqrtBig((num << 192n) / den);
}

/**
 * The gross input that moves the pool from `sqrtNow` to `sqrtTarget` inside the active range, from v4's amount
 * identities: amount1 = L * (b - a) and amount0 = L * (1/a - 1/b) on unscaled sqrt prices, then grossed up by the
 * fee. An estimate for one range only; V4Quoter then prices the chosen amount exactly, across ticks.
 */
export function inputToReach(
  sqrtNow: bigint,
  sqrtTarget: bigint,
  liquidity: bigint,
  feePips: number,
  quoteIs0: boolean,
): { side: Side; amountIn: bigint } | null {
  if (sqrtNow <= 0n || sqrtTarget <= 0n || liquidity <= 0n || sqrtNow === sqrtTarget) return null;
  // A rising sqrt price is v4's oneForZero direction: currency1 paid in, currency0 taken out.
  const up = sqrtTarget > sqrtNow;
  const net = up
    ? (liquidity * (sqrtTarget - sqrtNow)) / Q96
    : (liquidity * Q96 * (sqrtNow - sqrtTarget)) / (sqrtNow * sqrtTarget);
  const fee = BigInt(feePips);
  const gross = (net * PIPS + (PIPS - fee - 1n)) / (PIPS - fee);
  // Buying risky pays quote in; quote is the input currency1 exactly when quote is not currency0.
  const quoteIn = up ? !quoteIs0 : quoteIs0;
  return { side: quoteIn ? "buy" : "sell", amountIn: gross };
}
