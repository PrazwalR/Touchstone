// The arbitrage licence's timing (spec §10), from what the auction's views return. Pure, so it is unit-tested.

export interface LeaseView {
  owner: string;
  since: number;
  swapper: string;
  rent: bigint;
  deposit: bigint;
}

export interface LicenceTimeline {
  /** A lease is live and its holder's first large swap per block, inside the band, posts no deposit. */
  live: boolean;
  /** When the holder's deposit runs out at its rent, unless topped up or displaced first. */
  lapsesAt: bigint | null;
  /** When the pending bid takes over, if one is waiting. */
  activatesAt: bigint | null;
  /** The pending bid activates before the holder's deposit runs out, and displaces it. */
  displaces: boolean;
}

const EMPTY = "0x0000000000000000000000000000000000000000";

/**
 * leases() applies every transition up to now in memory, so the holder's `since` is the time rent is paid to and
 * its `deposit` what remains: it lapses at since + deposit / rent. A pending bid activates k seconds after it was
 * placed.
 */
export function licenceTimeline(top: LeaseView, next: LeaseView, k: number): LicenceTimeline {
  const live = top.owner.toLowerCase() !== EMPTY && top.rent > 0n;
  const lapsesAt = live ? BigInt(top.since) + top.deposit / top.rent : null;
  const pending = next.owner.toLowerCase() !== EMPTY && next.rent > 0n;
  const activatesAt = pending ? BigInt(next.since) + BigInt(k) : null;
  return {
    live,
    lapsesAt,
    activatesAt,
    displaces: lapsesAt !== null && activatesAt !== null && activatesAt < lapsesAt,
  };
}

/** Rent in quote base units per second, as quote base units per hour, for display. */
export function rentPerHour(rentPerSecond: bigint): bigint {
  return rentPerSecond * 3_600n;
}
