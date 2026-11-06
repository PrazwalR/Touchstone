// BigInt port of contracts/src/libraries/DepositLib.sol and SettlementMath.sol, with the same rounding.
// test/settlement.test.ts checks it against research/reference (report numbers and differential vectors).

export const BPS = 10_000n;
export const PIPS = 1_000_000n;
export const MODE_CONTINUOUS = 0;
export const MODE_CLOSED = 1;

export interface Payout {
  benign: boolean;
  refund: bigint;
  tip: bigint;
  toProtocol: bigint;
  toRebatePool: bigint;
  toLPs: bigint;
  rebate: bigint;
}

const min = (a: bigint, b: bigint): bigint => (a < b ? a : b);
const max = (a: bigint, b: bigint): bigint => (a > b ? a : b);

/** DepositLib.rateBps: min(deltaMax, max(delta, beta * g+)), or deltaClosed for a closure record. */
export function rateBps(mode: number, gapBps: bigint, deltaBps: bigint, deltaMaxBps: bigint, betaX100: bigint, deltaClosedBps: bigint): bigint {
  if (mode === MODE_CLOSED) return deltaClosedBps;
  const gPlus = gapBps > 0n ? gapBps : 0n;
  const scaled = (betaX100 * gPlus) / 100n;
  return min(max(scaled, deltaBps), deltaMaxBps);
}

/** DepositLib.quoteAmount: the deposit in quote units, rounded down. */
export function quoteAmount(notionalQuote: bigint, rate: bigint): bigint {
  return (notionalQuote * rate) / BPS;
}

/** SettlementMath.alphaBps: the LPs' share for a record's regime. */
export function alphaBps(mode: number, licenceActive: boolean, byHolder: boolean, inBand: boolean, alpha: bigint, alphaLicensed: bigint, alphaClosed: bigint): bigint {
  if (mode === MODE_CLOSED) return alphaClosed;
  if (!licenceActive || !inBand) return alpha;
  return byHolder ? 0n : alphaLicensed;
}

/** SettlementMath.clawback: R = min(D, alpha * max(0, m+ - (eps + c*) * N+)), rounded down. */
export function clawback(depositQuote: bigint, mPlus: bigint, nPlus: bigint, epsBps: bigint, confBps: bigint, alpha: bigint): bigint {
  if (mPlus <= 0n || alpha === 0n) return 0n;
  const margin = (nPlus * (epsBps + confBps)) / BPS;
  if (mPlus <= margin) return 0n;
  return min((alpha * (mPlus - margin)) / BPS, depositQuote);
}

export interface SplitParams {
  tipBps: bigint;
  tipCap: bigint;
  protocolShareBps: bigint;
  rhoBps: bigint;
}

/** SettlementMath.splitRetained: tip first, then the protocol share, then rho to the rebate pool; LPs get the rest. */
export function splitRetained(deposit: bigint, retained: bigint, p: SplitParams): Payout {
  if (retained > deposit) throw new Error("Touchstone__RetainedAboveDeposit");
  const tip = min((retained * p.tipBps) / BPS, p.tipCap);
  let rest = retained - tip;
  const toProtocol = (rest * p.protocolShareBps) / BPS;
  rest -= toProtocol;
  const toRebatePool = (rest * p.rhoBps) / BPS;
  return { benign: false, refund: deposit - retained, tip, toProtocol, toRebatePool, toLPs: rest - toRebatePool, rebate: 0n };
}

/** SettlementMath.benign: full refund, and a rebate of min(kappa * f * N, pool) with the tip taken from it. */
export function benign(deposit: bigint, notional: bigint, feePips: bigint, kappaBps: bigint, rebatePool: bigint, tipBps: bigint, tipCap: bigint): Payout {
  const gross = min((notional * feePips * kappaBps) / (PIPS * BPS), rebatePool);
  const tip = min((gross * tipBps) / BPS, tipCap);
  return { benign: true, refund: deposit, tip, toProtocol: 0n, toRebatePool: 0n, toLPs: 0n, rebate: gross - tip };
}

/** SettlementMath.conserves: the check finalize runs before it pays anything. */
export function conserves(p: Payout, deposit: bigint, rebatePool: bigint): boolean {
  if (p.benign) {
    return p.refund === deposit && p.toProtocol === 0n && p.toRebatePool === 0n && p.toLPs === 0n && p.tip + p.rebate <= rebatePool;
  }
  return p.rebate === 0n && p.refund + p.tip + p.toProtocol + p.toRebatePool + p.toLPs === deposit;
}
