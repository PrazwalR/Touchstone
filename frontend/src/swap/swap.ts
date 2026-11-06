import { submissionFees } from "./fees.ts";
// Quoting, guarding, executing and following a Touchstone swap (decision 0060). Pure functions over injected
// clients and addresses, so the Swap page, the Simulation page and the Anvil test run the same code.
import {
  decodeEventLog,
  encodeAbiParameters,
  erc20Abi,
  keccak256,
  maxUint256,
  parseAbi,
  zeroAddress,
  type Account,
  type Address,
  type Chain,
  type Hex,
  type PublicClient,
  type TransactionReceipt,
  type Transport,
  type WalletClient,
} from "viem";
import { guardedRouterAbi, settlerAbi, touchstoneHookAbi } from "../../abi/index.ts";

/** Uniswap v4-periphery V4Quoter: runs the real swap, hook included, in an eth_call and reports the output. */
const singleQuote = {
  type: "function",
  name: "quoteExactInputSingle",
  stateMutability: "nonpayable",
  inputs: [
    {
      name: "params",
      type: "tuple",
      components: [
        {
          name: "poolKey",
          type: "tuple",
          components: [
            { name: "currency0", type: "address" },
            { name: "currency1", type: "address" },
            { name: "fee", type: "uint24" },
            { name: "tickSpacing", type: "int24" },
            { name: "hooks", type: "address" },
          ],
        },
        { name: "zeroForOne", type: "bool" },
        { name: "exactAmount", type: "uint128" },
        { name: "hookData", type: "bytes" },
      ],
    },
  ],
  outputs: [
    { name: "amountOut", type: "uint256" },
    { name: "gasEstimate", type: "uint256" },
  ],
} as const;

export const v4QuoterAbi = [
  singleQuote,
  { ...singleQuote, name: "quoteExactOutputSingle", outputs: [
    { name: "amountIn", type: "uint256" }, { name: "gasEstimate", type: "uint256" },
  ] },
] as const;

export const BPS = 10_000n;
/** Extremes Pool.swap accepts as price limits: the swap may run to the end of the range, the guard bounds it. */
const MIN_LIMIT = 4295128740n;
const MAX_LIMIT = 1461446703485210103287273052203988822378723970341n;

export interface Token {
  symbol: string;
  address: Address; // zero for native ETH
  decimals: number;
}

export interface PoolKey {
  currency0: Address;
  currency1: Address;
  fee: number;
  tickSpacing: number;
  hooks: Address;
}

export interface SwapContext {
  client: PublicClient;
  manager: Address;
  hook: Address;
  settler: Address;
  router: Address;
  quoter: Address;
  key: PoolKey;
  poolId: Hex;
  risky: Token;
  quote: Token;
}

/** A buy pays the quote token for the risky one; a sell the reverse. */
export type Side = "buy" | "sell";

export const quoteIs0 = (ctx: SwapContext): boolean => ctx.key.currency0.toLowerCase() === ctx.quote.address.toLowerCase();
export const zeroForOne = (ctx: SwapContext, side: Side): boolean => (side === "buy") === quoteIs0(ctx);
export const tokenIn = (ctx: SwapContext, side: Side): Token => (side === "buy" ? ctx.quote : ctx.risky);
export const tokenOut = (ctx: SwapContext, side: Side): Token => (side === "buy" ? ctx.risky : ctx.quote);
export const isNative = (t: Token): boolean => t.address === zeroAddress;

/** Quote base units worth `riskyAmount` risky base units at the pool's sqrt price, rounded down. */
export function quoteValueOfRisky(riskyAmount: bigint, sqrtPriceX96: bigint, qIs0: boolean): bigint {
  const p2 = sqrtPriceX96 * sqrtPriceX96;
  if (p2 === 0n) return 0n;
  // sqrtP^2 / 2^192 is currency1 per currency0 in base units.
  return qIs0 ? (riskyAmount << 192n) / p2 : (riskyAmount * p2) >> 192n;
}

export interface DepositPreview {
  flaggedNow: boolean;
  exempt: boolean;
  mode: number;
  rateBps: number;
  triggers: number;
  depositIfFlagged: bigint; // quote units
  depositNow: bigint; // quote units
  settleAfter: bigint;
  expiresAt: bigint;
}

/** Recover the AMM's quote leg from a quote that already includes the hook's hold.
 * Spot-valuing the risky input is wrong when a swap moves through shallow liquidity.
 * Check the rounded candidate against previewDeposit instead of assuming the trade is flagged.
 */
export async function notionalFromQuote(
  quoted: bigint,
  side: Side,
  specified: bigint,
  exactOutput: boolean,
  readDeposit: (n: bigint) => Promise<DepositPreview>,
): Promise<bigint> {
  if (side === "buy" && !exactOutput) return specified;
  if (side === "sell" && exactOutput) return specified;
  const first = await readDeposit(quoted);
  const rate = BigInt(first.rateBps);
  if (rate < 0n || rate >= BPS) throw new Error("invalid deposit rate");
  const withHold = exactOutput
    ? (quoted * BPS + BPS + rate - 1n) / (BPS + rate)
    : (quoted * BPS) / (BPS - rate);
  // A floor at the deposit step can leave two adjacent valid base-unit candidates.
  for (const n of new Set([withHold, exactOutput ? withHold + 1n : withHold - 1n, quoted])) {
    if (n <= 0n) continue;
    const d = n === quoted ? first : await readDeposit(n);
    if ((exactOutput ? n + d.depositNow : n - d.depositNow) === quoted) return n;
  }
  throw new Error("Quote and deposit preview disagree; refresh before trading.");
}

export interface Preview {
  side: Side;
  exactOutput: boolean;
  specified: bigint;
  account: Address | undefined;
  amountIn: bigint;
  zeroForOne: boolean;
  notionalQuote: bigint;
  deposit: DepositPreview;
  /** Output net of any deposit, from V4Quoter, which runs the real swap. */
  netOut: bigint;
  /** The deposit in the unspecified currency if the swap were flagged: the most a guard should accept. */
  depositBound: bigint;
  /** An exact eth_call of swapGuarded from the account, when it can run (allowance and balance in place). */
  exact: { netOut: bigint; netIn: bigint; deposit: bigint } | null;
  exactError: string | null;
  balanceIn: bigint | null;
  allowance: bigint | null;
  needsApproval: boolean;
  /** The pool's sqrt price the preview was taken at. */
  sqrtPriceX96: bigint;
  blockNumber: bigint;
}

/** Everything the page shows before signing. `account` is optional: without a wallet the quote still works. */
export async function previewSwap(ctx: SwapContext, side: Side, specified: bigint, account?: Address, exactOutput = false): Promise<Preview> {
  if (specified <= 0n || specified >= 1n << 127n) throw new Error("amount outside V4Quoter range");
  const zfo = zeroForOne(ctx, side);
  const blockNumber = await ctx.client.getBlockNumber({ cacheTime: 0 });
  const at = { blockNumber };
  const sqrtPriceX96 = await poolSqrtPrice(ctx, blockNumber);
  const tIn = tokenIn(ctx, side);
  const [quote, balanceIn, allowance] = await Promise.all([
    ctx.client.simulateContract({
      ...at,
      ...(account ? { account } : {}),
      address: ctx.quoter,
      abi: v4QuoterAbi,
      functionName: exactOutput ? "quoteExactOutputSingle" : "quoteExactInputSingle",
      args: [{ poolKey: ctx.key, zeroForOne: zfo, exactAmount: specified, hookData: "0x" }],
    }).then((r) => r.result[0]),
    account === undefined
      ? Promise.resolve(null)
      : isNative(tIn)
        ? ctx.client.getBalance({ address: account, ...at })
        : ctx.client.readContract({ ...at, address: tIn.address, abi: erc20Abi, functionName: "balanceOf", args: [account] }),
    account === undefined || isNative(tIn)
      ? Promise.resolve(null)
      : ctx.client.readContract({ ...at, address: tIn.address, abi: erc20Abi, functionName: "allowance", args: [account, ctx.router] }),
  ]);
  const amountIn = exactOutput ? quote : specified;
  const netOut = exactOutput ? specified : quote;
  const needsApproval = allowance !== null && allowance < amountIn;
  let exact: Preview["exact"] = null;
  let exactError: string | null = null;
  if (account !== undefined && !needsApproval && balanceIn !== null && balanceIn >= amountIn) {
    try {
      const sim = await ctx.client.simulateContract({
        ...at,
        account,
        address: ctx.router,
        abi: guardedRouterAbi,
        functionName: "swapGuarded",
        args: [ctx.key, swapParams(zfo, specified, exactOutput), openGuard(amountIn), account, maxUint256],
        value: isNative(tIn) ? amountIn : 0n,
      });
      const [delta, dep] = sim.result;
      const inputLeg = BigInt.asIntN(128, zfo ? delta >> 128n : delta);
      exact = { netOut: outOf(delta, zfo), netIn: -inputLeg, deposit: dep };
      if (exactOutput && exact.netOut !== specified) throw new Error("insufficient liquidity for the requested output");
    } catch (err) {
      exact = null;
      exactError = shortError(err);
    }
  }
  const readDeposit = (n: bigint, swapper: Address) => ctx.client.readContract({
    ...at, address: ctx.hook, abi: touchstoneHookAbi, functionName: "previewDeposit",
    args: [ctx.key, zfo, n, swapper],
  });
  // The real router simulation knows executed legs and the actual hold, including near-budget decisions.
  // previewDeposit approximates risky exposure at spot and cannot safely recover that notional first.
  const notionalQuote = exact
    ? side === "buy"
      ? exact.netIn - (exactOutput ? exact.deposit : 0n)
      : exact.netOut + (exactOutput ? 0n : exact.deposit)
    : await notionalFromQuote(quote, side, specified, exactOutput, (n) => readDeposit(n, ctx.quoter));
  const deposit = await ctx.client.readContract({
    ...at, address: ctx.hook, abi: touchstoneHookAbi, functionName: "previewDeposit",
    args: [ctx.key, zfo, notionalQuote, account ?? zeroAddress],
  });
  const d = deposit.depositIfFlagged;
  // Exact-output sells pay in risky units. Net input includes any deposit, so using it
  // for conversion rounds the bound up. Exact-input buys convert from net to gross output.
  const depositBound = exactOutput
    ? (side === "buy" ? d : (d * amountIn + specified - 1n) / specified)
    : (side === "sell" ? d : notionalQuote <= d ? 0n : (d * quote + notionalQuote - d - 1n) / (notionalQuote - d));

  return {
    side,
    exactOutput,
    specified,
    account,
    amountIn,
    zeroForOne: zfo,
    notionalQuote,
    deposit,
    netOut,
    depositBound,
    exact,
    exactError,
    balanceIn,
    allowance,
    needsApproval,
    sqrtPriceX96,
    blockNumber,
  };
}

/**
 * How much worse than the pool's spot price the swap executes, LP fee included, in basis points. Measured on the
 * gross output (net plus deposit): the deposit is refundable and settled, not part of the price.
 */
export function priceImpactBps(ctx: SwapContext, p: Preview): number {
  const deposit = p.exact?.deposit ?? (p.deposit.flaggedNow ? p.depositBound : 0n);
  const grossOut = (p.exact?.netOut ?? p.netOut) + (p.exactOutput ? 0n : deposit);
  const grossIn = (p.exact?.netIn ?? p.amountIn) - (p.exactOutput ? deposit : 0n);
  const qIs0 = quoteIs0(ctx);
  // Both sides in quote units at the spot price.
  const spentQuote = p.side === "buy" ? grossIn : quoteValueOfRisky(grossIn, p.sqrtPriceX96, qIs0);
  const gotQuote = p.side === "buy" ? quoteValueOfRisky(grossOut, p.sqrtPriceX96, qIs0) : grossOut;
  if (spentQuote === 0n) return 0;
  return Number(((spentQuote - gotQuote) * BPS) / spentQuote);
}

const extsloadAbi = [
  { type: "function", name: "extsload", stateMutability: "view", inputs: [{ type: "bytes32" }], outputs: [{ type: "bytes32" }] },
] as const;

/** The pool's sqrt price from PoolManager storage, as v4's StateLibrary reads it: slot0 sits at
 * keccak256(poolId . POOLS_SLOT) with POOLS_SLOT = 6, and the price is its low 160 bits. */
export async function poolSqrtPrice(ctx: SwapContext, blockNumber?: bigint): Promise<bigint> {
  const slot = keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "uint256" }], [ctx.poolId, 6n]));
  const word = await ctx.client.readContract({
    ...(blockNumber === undefined ? {} : { blockNumber }),
    address: ctx.manager,
    abi: extsloadAbi,
    functionName: "extsload",
    args: [slot],
  });
  return BigInt(word) & ((1n << 160n) - 1n);
}

export function swapParams(zfo: boolean, specified: bigint, exactOutput = false) {
  return { zeroForOne: zfo, amountSpecified: exactOutput ? specified : -specified, sqrtPriceLimitX96: zfo ? MIN_LIMIT : MAX_LIMIT } as const;
}

/** A guard that accepts anything, for an eth_call that only measures. Never sent in a transaction. */
function openGuard(amountIn: bigint) {
  return { maxDeposit: maxUint256, minNetOut: 0n, minGrossOut: 0n, maxNetIn: amountIn } as const;
}

export interface Guard {
  maxDeposit: bigint;
  minNetOut: bigint;
  minGrossOut: bigint;
  maxNetIn: bigint;
}

/**
 * The limits a transaction carries. Output may fall by `slippageBps`; the deposit may be as large as the flagged
 * deposit plus slippage, because a deposit is held and settled, not lost, and another swap landing first in the
 * block can flag this one. Everything else reverts on chain.
 */
export function guardFor(p: Preview, slippageBps: bigint): Guard {
  if (slippageBps < 0n || slippageBps >= BPS) throw new Error("slippage out of range");
  const netOut = p.exact?.netOut ?? p.netOut;
  const deposit = p.exact?.deposit ?? 0n;
  const expectedDeposit = deposit > p.depositBound ? deposit : p.depositBound;
  const minNetOut = p.exactOutput ? netOut : (netOut * (BPS - slippageBps)) / BPS;
  return {
    maxDeposit: (expectedDeposit * (BPS + slippageBps)) / BPS + 1n,
    minNetOut,
    // Gross output is net plus the deposit, so it is at least the net floor.
    minGrossOut: minNetOut,
    maxNetIn: p.exactOutput ? ((p.exact?.netIn ?? p.amountIn) * (BPS + slippageBps) + BPS - 1n) / BPS : p.amountIn,
  };
}

type Wallet = WalletClient<Transport, Chain, Account>;

/** Approves the router for exactly this swap's input; never an unlimited allowance. */
export async function approveExact(ctx: SwapContext, wallet: Wallet, token: Token, amount: bigint): Promise<TransactionReceipt> {
  if (isNative(token)) throw new Error("native ETH needs no approval");
  const { request } = await ctx.client.simulateContract({
    account: wallet.account,
    address: token.address,
    abi: erc20Abi,
    functionName: "approve",
    args: [ctx.router, amount],
  });
  const receipt = await ctx.client.waitForTransactionReceipt({ hash: await wallet.writeContract({
    address: request.address,
    abi: request.abi,
    functionName: request.functionName,
    args: request.args,
    account: wallet.account,
    value: request.value,
    ...await submissionFees(ctx.client),
  }) });
  if (receipt.status !== "success") throw new Error("approval reverted");
  return receipt;
}

export interface SwapResult {
  hash: Hex;
  receipt: TransactionReceipt;
  record: TouchstoneRecord | null;
  /** Confirmed swap amounts from the receipt, including the hook hold and excluding transaction gas. */
  paid: bigint;
  received: bigint;
}

export interface TouchstoneRecord {
  poolId: Hex;
  id: bigint;
  timestamp: number;
  mode: number;
  zeroForOne: boolean;
  depositIn0: boolean;
  beneficiary: Address;
  rebateTo: Address;
  deposit: bigint;
  amount0: bigint;
  amount1: bigint;
  swapFeePips: number;
  raw: unknown;
}

export const poolManagerSwapAbi = parseAbi([
  "event Swap(bytes32 indexed id,address indexed sender,int128 amount0,int128 amount1,uint160 sqrtPriceX96,uint128 liquidity,int24 tick,uint24 fee)",
]);

/** PoolManager emits the AMM legs before afterSwap; the hook hold adjusts the unspecified leg. */
export function swapAmountsFromReceipt(
  ctx: SwapContext,
  side: Side,
  receipt: TransactionReceipt,
  record: Pick<TouchstoneRecord, "amount0" | "amount1" | "deposit" | "depositIn0"> | null,
): { paid: bigint; received: bigint } {
  let amounts: { amount0: bigint; amount1: bigint } | null = record;
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== ctx.manager.toLowerCase()) continue;
    try {
      const event = decodeEventLog({ abi: poolManagerSwapAbi, data: log.data, topics: log.topics });
      if (event.args.id.toLowerCase() !== ctx.poolId.toLowerCase() || event.args.sender.toLowerCase() !== ctx.router.toLowerCase()) continue;
      amounts = event.args;
      break;
    } catch {
      // Other PoolManager events are not this swap's signed AMM legs.
    }
  }
  if (!amounts) throw new Error(`Swap confirmed in ${receipt.transactionHash}, but its swap amounts could not be decoded.`);
  const zfo = zeroForOne(ctx, side);
  const input = zfo ? amounts.amount0 : amounts.amount1;
  const output = zfo ? amounts.amount1 : amounts.amount0;
  const heldInInput = record !== null && record.depositIn0 === zfo;
  const deposit = record?.deposit ?? 0n;
  const paid = -input + (heldInInput ? deposit : 0n);
  const received = output - (heldInInput ? 0n : deposit);
  if (paid < 0n || received < 0n) throw new Error(`Swap confirmed in ${receipt.transactionHash}, but its swap amounts are invalid.`);
  return { paid, received };
}

/** Simulates once more with the final guard, sends, waits, and decodes the record the hook opened, if any. */
export async function executeSwap(
  ctx: SwapContext,
  wallet: Wallet,
  side: Side,
  specified: bigint,
  guard: Guard,
  deadline: bigint,
  exactOutput = false,
  onSubmitted?: (hash: Hex) => void,
): Promise<SwapResult> {
  const account = wallet.account.address;
  const zfo = zeroForOne(ctx, side);
  const tIn = tokenIn(ctx, side);
  const { request, result } = await ctx.client.simulateContract({
    account: wallet.account,
    address: ctx.router,
    abi: guardedRouterAbi,
    functionName: "swapGuarded",
    args: [ctx.key, swapParams(zfo, specified, exactOutput), guard, account, deadline],
    value: isNative(tIn) ? guard.maxNetIn : 0n,
  });
  if (exactOutput && outOf(result[0], zfo) !== specified) throw new Error("insufficient liquidity for the requested output");
  const hash = await wallet.writeContract({
    address: request.address,
    abi: request.abi,
    functionName: request.functionName,
    args: request.args,
    account: wallet.account,
    value: request.value,
    ...await submissionFees(ctx.client),
  });
  onSubmitted?.(hash);
  return confirmSwap(ctx, side, hash);
}

/** A confirmed onchain revert, unlike an unresolved receipt RPC failure. */
export class SwapRevertedError extends Error {
  readonly hash: Hex;
  constructor(hash: Hex) {
    super(`Swap reverted in ${hash}`);
    this.name = "SwapRevertedError";
    this.hash = hash;
  }
}

/** Resume receipt confirmation for an already submitted transaction without signing a second swap. */
export async function confirmSwap(ctx: SwapContext, side: Side, hash: Hex): Promise<SwapResult> {
  const receipt = await ctx.client.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new SwapRevertedError(hash);
  const record = recordFromReceipt(ctx, receipt);
  return { hash, receipt, record, ...swapAmountsFromReceipt(ctx, side, receipt, record) };
}

export function recordFromReceipt(ctx: SwapContext, receipt: TransactionReceipt): TouchstoneRecord | null {
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== ctx.hook.toLowerCase()) continue;
    try {
      const ev = decodeEventLog({ abi: touchstoneHookAbi, data: log.data, topics: log.topics });
      if (ev.eventName !== "DepositTaken") continue;
      const r = ev.args.record;
      if (r.poolId.toLowerCase() !== ctx.poolId.toLowerCase()) continue;
      return {
        poolId: r.poolId,
        id: r.id,
        timestamp: r.timestamp,
        mode: r.mode,
        zeroForOne: r.zeroForOne,
        depositIn0: r.depositIn0,
        beneficiary: r.beneficiary,
        rebateTo: r.rebateTo,
        deposit: r.deposit,
        amount0: r.amount0,
        amount1: r.amount1,
        swapFeePips: r.swapFeePips,
        raw: r,
      };
    } catch {
      // Other hook events in the same transaction.
    }
  }
  return null;
}

export type RecordOutcome =
  | { kind: "open" }
  | {
      kind: "settled";
      hash: Hex;
      markout: bigint;
      fairPriceX36: bigint;
      alphaBps: number;
      payout: { benign: boolean; refund: bigint; tip: bigint; toProtocol: bigint; toRebatePool: bigint; toLPs: bigint; rebate: bigint };
    }
  | { kind: "expired"; hash: Hex; refund: bigint };

/** Whether the record has been settled or expired yet, from the Settler's events since the swap's block. */
export async function recordOutcome(ctx: SwapContext, poolId: Hex, recordId: bigint, fromBlock: bigint): Promise<RecordOutcome> {
  const range = { address: ctx.settler, abi: settlerAbi, args: { id: poolId, recordId }, fromBlock, toBlock: "latest" } as const;
  const [settled, expired] = await Promise.all([
    ctx.client.getContractEvents({ ...range, eventName: "Settled" }),
    ctx.client.getContractEvents({ ...range, eventName: "Expired" }),
  ]);
  const s = settled[0];
  if (s?.transactionHash && s.args.payout && s.args.markout !== undefined && s.args.fairPriceX36 !== undefined && s.args.alphaBps !== undefined) {
    return { kind: "settled", hash: s.transactionHash, markout: s.args.markout, fairPriceX36: s.args.fairPriceX36, alphaBps: s.args.alphaBps, payout: s.args.payout };
  }
  const e = expired[0];
  if (e?.transactionHash && e.args.refund !== undefined) return { kind: "expired", hash: e.transactionHash, refund: e.args.refund };
  return { kind: "open" };
}

function outOf(delta: bigint, zfo: boolean): bigint {
  // BalanceDelta packs amount0 in the high 128 bits and amount1 in the low 128, both signed.
  const amount0 = BigInt.asIntN(128, delta >> 128n);
  const amount1 = BigInt.asIntN(128, delta);
  const out = zfo ? amount1 : amount0;
  return out > 0n ? out : 0n;
}

/** The first line of a viem error, for display. */
export function shortError(err: unknown): string {
  if (!(err instanceof Error)) return "request failed";
  const short = "shortMessage" in err && typeof err.shortMessage === "string" ? err.shortMessage : err.message;
  return (short || "request failed").split("\n")[0]!.slice(0, 200);
}
