/** Reproducible sampling for testnet demonstrations; never a source of financial randomness. */
export function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

/** Quote-per-risky whole-token price from slot0, for reference-direction selection only. */
export function spot(
  sqrt: bigint,
  quoteIs0: boolean,
  quoteDecimals: number,
  riskyDecimals: number,
): number {
  const raw = Number(sqrt) ** 2 / 2 ** 192;
  const px = (quoteIs0 ? 1 / raw : raw) * 10 ** (riskyDecimals - quoteDecimals);
  if (!Number.isFinite(px) || px <= 0) throw new Error("invalid pool price");
  return px;
}

export function arbitrageDirection(
  poolPrice: number,
  fair: number,
  minEdgeBps: number,
  quoteIs0: boolean,
): boolean | null {
  if (
    ![poolPrice, fair, minEdgeBps].every(Number.isFinite) ||
    poolPrice <= 0 ||
    fair <= 0 ||
    minEdgeBps <= 0
  )
    throw new Error("invalid strategy inputs");
  if ((Math.abs(fair - poolPrice) * 10_000) / fair < minEdgeBps) return null;
  const buyRisky = fair > poolPrice;
  return buyRisky === quoteIs0;
}

/** Sample integer token units without converting balances through floating-point numbers. */
export function sampleAmount(
  random: () => number,
  min: bigint,
  max: bigint,
): bigint {
  if (min <= 0n || max < min || max >= 2n ** 128n)
    throw new Error("invalid amount range");
  const width = max - min + 1n;
  const limit = 2n ** 128n - (2n ** 128n % width);
  for (;;) {
    let draw = 0n;
    for (let i = 0; i < 4; i++)
      draw = (draw << 32n) | BigInt(Math.floor(random() * 2 ** 32));
    if (draw < limit) return min + (draw % width);
  }
}

/** GuardedRouter's failure code for a deposit above the trader's maxDeposit (src/periphery/GuardedRouter.sol). */
export const GUARD_FAILED_MAX_DEPOSIT = 1;

export interface AuctionView {
  /** Lowest rent a new bid may offer now, quote base units per second. */
  minNextRent: bigint;
  /** Notice: a deposit must cover k seconds of rent. */
  k: number;
  holderOwner: string;
  pendingOwner: string;
}

export interface BidLimits {
  self: string;
  /** Most rent the bot will pay, quote base units per second. */
  maxRent: bigint;
  /** Seconds of rent the deposit should cover; never less than the notice. */
  leaseSeconds: number;
  /** Most quote base units the bot will lock in one bid. */
  maxDeposit: bigint;
}

export type BidPlan =
  | { bid: true; rent: bigint; deposit: bigint }
  | { bid: false; reason: "already holder" | "already pending" | "rent above limit" | "deposit above limit" };

/** The smallest valid bid within the bot's limits: the minimum rent, with a deposit for leaseSeconds of it. */
export function planBid(a: AuctionView, l: BidLimits): BidPlan {
  if (a.minNextRent <= 0n || !Number.isSafeInteger(a.k) || a.k <= 0 || !Number.isSafeInteger(l.leaseSeconds) || l.leaseSeconds <= 0)
    throw new Error("invalid auction view or bid limits");
  const self = l.self.toLowerCase();
  if (a.holderOwner.toLowerCase() === self) return { bid: false, reason: "already holder" };
  if (a.pendingOwner.toLowerCase() === self) return { bid: false, reason: "already pending" };
  if (a.minNextRent > l.maxRent) return { bid: false, reason: "rent above limit" };
  const deposit = a.minNextRent * BigInt(Math.max(l.leaseSeconds, a.k));
  if (deposit > l.maxDeposit) return { bid: false, reason: "deposit above limit" };
  return { bid: true, rent: a.minNextRent, deposit };
}

/** True when a swap simulation failed only because the hook would take a deposit the guard does not allow. */
export function isDepositRefusal(err: unknown): boolean {
  for (let e: unknown = err, depth = 0; e instanceof Error && depth < 8; e = e.cause, depth++) {
    const data = (e as { data?: { errorName?: unknown; args?: readonly unknown[] } }).data;
    if (data?.errorName === "Touchstone__GuardFailed" && Number(data.args?.[0]) === GUARD_FAILED_MAX_DEPOSIT) return true;
  }
  return false;
}
