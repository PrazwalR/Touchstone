// Read-only chain access. No wallet, no signing, no transaction: every call here is eth_call or eth_getLogs.
import { createClient, defineChain, http, parseAbi, type Address, type Hex } from "viem";
import { getBlock, getChainId, getLogs, readContract } from "viem/actions";
import { licenceAuctionAbi, nyseCalendarAbi, rebateLedgerAbi, touchstoneFactoryAbi, touchstoneHookAbi } from "../../abi/index.ts";
import { RPC_URL } from "../config.ts";
import { deployment, pool } from "./deployment.ts";

// Uniswap v4 periphery StateView, the two views the page needs.
const stateViewAbi = parseAbi([
  "function getSlot0(bytes32 poolId) view returns (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee)",
  "function getLiquidity(bytes32 poolId) view returns (uint128 liquidity)",
]);

// The chain comes from the deployment file, the single source of per-chain values.
export const chain = defineChain({
  id: deployment.chainId,
  name: deployment.name,
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
  blockExplorers: { default: { name: "Explorer", url: deployment.explorer } },
});

// A bare client with only the read actions imported below, so the bundle carries no signing or KZG code.
const client = createClient({
  chain,
  transport: http(RPC_URL, { retryCount: 2, timeout: 12_000 }),
  batch: { multicall: false },
});

const C = deployment.contracts;
const id = pool.poolId;

export const poolKey = {
  currency0: pool.currency0,
  currency1: pool.currency1,
  fee: pool.fee,
  tickSpacing: pool.tickSpacing,
  hooks: pool.hooks,
} as const;

export type PoolState = {
  lastTouchBlock: bigint;
  nextRecordId: bigint;
  vestLast: number;
  outstanding0: bigint;
  outstanding1: bigint;
  rebatePool0: bigint;
  rebatePool1: bigint;
  vest0: bigint;
  vest1: bigint;
};

export interface Snapshot {
  blockNumber: bigint;
  blockTime: bigint;
  sqrtPriceX96: bigint;
  tick: number;
  lpFee: number;
  liquidity: bigint;
  state: PoolState;
  config: {
    n0: bigint;
    nMin: bigint;
    flags: number;
    referenceFeed: Address;
    referenceMaxAge: number;
    tauBps: number;
    deltaBps: number;
    deltaMaxBps: number;
    betaX100: number;
    deltaClosedBps: number;
    epsBps: number;
    alphaBps: number;
    alphaLicensedBps: number;
    alphaClosedBps: number;
    epsClosedBps: number;
    tipBps: number;
    tipCap: bigint;
    rhoBps: number;
    kappaBps: number;
    protocolShareBps: number;
    settleDelay: number;
    maxLag: number;
    window: number;
    vestPeriod: number;
    calendar: Address;
    maxOutstanding: bigint;
  };
  calendar: { open: boolean; nextOpen: bigint; validUntil: bigint } | null;
  ledgerOwed: { risky: bigint; quote: bigint };
}

/** One consistent read of the pool, the hook, the factory config, the NYSE calendar and the ledger. */
export async function readSnapshot(): Promise<Snapshot> {
  const block = await getBlock(client, { blockTag: "latest" });
  const at = { blockNumber: block.number };
  const now = block.timestamp;
  const [slot0, liquidity, st, cfg, calendar, owedRisky, owedQuote] = await Promise.all([
    readContract(client, { ...at, address: deployment.uniswap.stateView, abi: stateViewAbi, functionName: "getSlot0", args: [id] }),
    readContract(client, { ...at, address: deployment.uniswap.stateView, abi: stateViewAbi, functionName: "getLiquidity", args: [id] }),
    readContract(client, { ...at, address: C.hook, abi: touchstoneHookAbi, functionName: "poolState", args: [id] }),
    readContract(client, { ...at, address: C.factory, abi: touchstoneFactoryAbi, functionName: "poolConfig", args: [id] }),
    C.nyseCalendar && Promise.all([
      readContract(client, { ...at, address: C.nyseCalendar, abi: nyseCalendarAbi, functionName: "isOpen", args: [now] }),
      readContract(client, { ...at, address: C.nyseCalendar, abi: nyseCalendarAbi, functionName: "nextOpen", args: [now] }),
      readContract(client, { ...at, address: C.nyseCalendar, abi: nyseCalendarAbi, functionName: "validUntil" }),
    ]).then(([open, nextOpen, validUntil]) => ({ open, nextOpen, validUntil })),
    readContract(client, { ...at, address: C.ledger, abi: rebateLedgerAbi, functionName: "totalOwed", args: [deployment.tokens.risky.address] }),
    readContract(client, { ...at, address: C.ledger, abi: rebateLedgerAbi, functionName: "totalOwed", args: [deployment.tokens.quote.address] }),
  ]);
  if (slot0[0] === 0n) throw new Error("the pool is not initialised on this RPC's chain");
  return {
    blockNumber: block.number,
    blockTime: now,
    sqrtPriceX96: slot0[0],
    tick: slot0[1],
    lpFee: slot0[3],
    liquidity,
    state: st,
    config: cfg,
    calendar,
    ledgerOwed: { risky: owedRisky, quote: owedQuote },
  };
}

/** USDC per ETH, scaled by 1e6, from the pool's sqrt price (currency0 ETH, 18 decimals; currency1 USDC, 6). */
export function priceQuotePerRiskyE6(sqrtPriceX96: bigint): bigint {
  const d0 = BigInt(deployment.tokens.risky.decimals);
  const d1 = BigInt(deployment.tokens.quote.decimals);
  // price1per0 in base units = sqrtP^2 / 2^192; in whole tokens multiply by 10^(d0 - d1); keep 6 places.
  return (sqrtPriceX96 * sqrtPriceX96 * 10n ** (d0 - d1 + 6n)) >> 192n;
}

type HookAbiItem = (typeof touchstoneHookAbi)[number];
function eventAbi<N extends "DepositTaken" | "Settled" | "Expired">(name: N): Extract<HookAbiItem, { type: "event"; name: N }> {
  const item = touchstoneHookAbi.find((e): e is Extract<HookAbiItem, { type: "event"; name: N }> => e.type === "event" && e.name === name);
  if (!item) throw new Error(`the hook ABI has no ${name} event`);
  return item;
}

export type RecordEvent =
  | { kind: "deposit"; recordId: bigint; block: bigint; tx: Hex; logIndex: number; deposit: bigint; depositIn0: boolean; mode: number; timestamp: number; sender: Address }
  | { kind: "settled"; recordId: bigint; block: bigint; tx: Hex; logIndex: number; markout: bigint; alphaBps: number; refund: bigint; toLPs: bigint; tip: bigint; benign: boolean }
  | { kind: "expired"; recordId: bigint; block: bigint; tx: Hex; logIndex: number; refund: bigint };

/** Every record event of the pool since the deployment block, newest first. */
export async function readEvents(): Promise<RecordEvent[]> {
  // One address and one event per query: the public RPC caps a query with several values in any filter field
  // at 100,000 blocks, and a single-valued one at none. The hook emits DepositTaken; the Settler emits Settled
  // and Expired (decision 0018).
  const range = { fromBlock: BigInt(deployment.deployBlock), toBlock: "latest" } as const;
  const [deposits, settled, expired] = await Promise.all([
    getLogs(client, { ...range, address: C.hook, event: eventAbi("DepositTaken") }),
    getLogs(client, { ...range, address: C.settler, event: eventAbi("Settled") }),
    getLogs(client, { ...range, address: C.settler, event: eventAbi("Expired") }),
  ]);
  const logs = [...deposits, ...settled, ...expired];
  const out: RecordEvent[] = [];
  for (const l of logs) {
    if (l.blockNumber === null || l.transactionHash === null || l.logIndex === null) continue;
    const base = { block: l.blockNumber, tx: l.transactionHash, logIndex: l.logIndex };
    if (l.eventName === "DepositTaken" && l.args.id === id && l.args.record && l.args.recordId !== undefined) {
      const r = l.args.record;
      out.push({ ...base, kind: "deposit", recordId: l.args.recordId, deposit: r.deposit, depositIn0: r.depositIn0, mode: r.mode, timestamp: r.timestamp, sender: r.sender });
    } else if (l.eventName === "Settled" && l.args.id === id && l.args.payout && l.args.recordId !== undefined) {
      const p = l.args.payout;
      out.push({ ...base, kind: "settled", recordId: l.args.recordId, markout: l.args.markout ?? 0n, alphaBps: l.args.alphaBps ?? 0, refund: p.refund, toLPs: p.toLPs, tip: p.tip, benign: p.benign });
    } else if (l.eventName === "Expired" && l.args.id === id && l.args.recordId !== undefined) {
      out.push({ ...base, kind: "expired", recordId: l.args.recordId, refund: l.args.refund ?? 0n });
    }
  }
  out.sort((a, b) => (a.block === b.block ? b.logIndex - a.logIndex : a.block < b.block ? 1 : -1));
  return out;
}

/** The pool's licence as of the latest block: null when the deployment has no auction or the pool no licence. */
export interface LicenceState {
  blockNumber: bigint;
  blockTime: bigint;
  holder: Address;
  live: boolean;
  top: { owner: Address; since: number; swapper: Address; rent: bigint; deposit: bigint };
  next: { owner: Address; since: number; swapper: Address; rent: bigint; deposit: bigint };
  minNextRent: bigint;
  k: number;
  minIncrementBps: number;
}

/** PoolFlags.LICENCE in src/types/PoolConfig.sol. */
const FLAG_LICENCE = 2;

export async function readLicence(): Promise<LicenceState | null> {
  const auction = C.licenceAuction;
  if (auction === null) return null;
  const block = await getBlock(client, { blockTag: "latest" });
  const at = { blockNumber: block.number };
  const cfg = await readContract(client, { ...at, address: C.factory, abi: touchstoneFactoryAbi, functionName: "poolConfig", args: [id] });
  if ((cfg.flags & FLAG_LICENCE) === 0) return null;
  const [holder, leases, minNextRent, terms] = await Promise.all([
    readContract(client, { ...at, address: auction, abi: licenceAuctionAbi, functionName: "holderOf", args: [id] }),
    readContract(client, { ...at, address: auction, abi: licenceAuctionAbi, functionName: "leases", args: [id] }),
    readContract(client, { ...at, address: auction, abi: licenceAuctionAbi, functionName: "minNextRent", args: [id] }),
    readContract(client, { ...at, address: auction, abi: licenceAuctionAbi, functionName: "terms", args: [id] }),
  ]);
  return {
    blockNumber: block.number,
    blockTime: block.timestamp,
    holder: holder[0],
    live: holder[1],
    top: leases[0],
    next: leases[1],
    minNextRent,
    k: terms[1],
    minIncrementBps: terms[2],
  };
}

/** Fails when the RPC serves a different chain from the deployment's. */
export async function checkChain(): Promise<void> {
  const chainId = await getChainId(client);
  if (chainId !== deployment.chainId) throw new Error(`RPC serves chain ${chainId}, expected ${deployment.chainId}`);
}
