import {
  BaseError,
  ContractFunctionRevertedError,
  parseAbi,
  type Account,
  type Address,
  type Chain,
  type Hex,
  type PublicClient,
  type Transport,
  type WalletClient,
} from "viem";
import {
  decodeDepositTaken,
  licenceAuctionAbi,
  rebateLedgerAbi,
  settlerAbi,
  touchstoneFactoryAbi,
  touchstoneHookAbi,
  type TouchstoneRecord,
} from "@touchstone/shared";
import { Hermes, HermesError, toFloat, type PythUpdate } from "./hermes.ts";
import { nextAction, type SettleWindow } from "./schedule.ts";
import { recordKey, type KeeperState } from "./state.ts";

const pythAbi = parseAbi(["function getUpdateFee(bytes[] updateData) view returns (uint256)"]);
const settlerPythAbi = parseAbi(["function PYTH() view returns (address)"]);

export interface KeeperPolicy {
  startBlock: bigint;
  accrueIntervalS?: number;
  minMarginBps: number;
  settleAtLoss: boolean;
  logBlockRange: bigint;
  dripsPerPeriod: number;
  nativePriceId: Hex;
  pushRecipients: Address[];
}

export interface KeeperAddresses {
  hook: Address;
  settler: Address;
  factory: Address;
  ledger: Address;
  licence?: Address;
}

type Log = (level: "info" | "warn" | "error", msg: string, fields?: Record<string, unknown>) => void;

interface PoolInfo {
  licensed: boolean;
  basePriceId: Hex;
  quotePriceId: Hex;
  quoteIs0: boolean;
  decimals0: number;
  decimals1: number;
  vestPeriod: number;
  currency0: Address;
  currency1: Address;
  key: { currency0: Address; currency1: Address; fee: number; tickSpacing: number; hooks: Address };
}

export interface TickReport {
  ingested: number;
  settled: number;
  expired: number;
  closedElsewhere: number;
  dripped: number;
  pushed: number;
  accrued: number;
}

/**
 * Spec §15.1. Nothing here is trusted by the contracts: a settlement the keeper misses can be made by anyone,
 * and anyone may submit expiry to refund an eligible record. Simulation catches already-invalid calls;
 * races after simulation can still consume transaction gas.
 *
 * Settlements are sent one per transaction. Batching through Multicall3, as §15.1 step 6 suggests, would make
 * Multicall3 the Settler's msg.sender and so the tip recipient (decision 0036).
 */
export class Keeper {
  readonly #windows = new Map<string, SettleWindow>();
  readonly #pools = new Map<Hex, PoolInfo>();
  readonly #lastAccrue = new Map<Hex, number>();
  readonly #lastDrip = new Map<Hex, number>();
  readonly #open = new Map<string, TouchstoneRecord>();
  readonly #poolIds = new Set<Hex>();
  #pyth: Address | undefined;
  #nextBlock: bigint;
  #lastBlockHash: Hex | undefined;
  private readonly client: PublicClient<Transport, Chain>;
  private readonly wallet: WalletClient<Transport, Chain, Account>;
  private readonly hermes: Hermes;
  private readonly at: KeeperAddresses;
  private readonly policy: KeeperPolicy;
  readonly #spend: { t: number; wei: bigint }[] = [];
  private readonly log: Log;

  constructor(
    client: PublicClient<Transport, Chain>,
    wallet: WalletClient<Transport, Chain, Account>,
    hermes: Hermes,
    at: KeeperAddresses,
    policy: KeeperPolicy,
    state: KeeperState,
    log: Log,
  ) {
    if (at.licence !== undefined && (!Number.isSafeInteger(policy.accrueIntervalS) || (policy.accrueIntervalS ?? 0) <= 0)) throw new Error("licence accrual requires a positive interval");
    this.client = client;
    this.wallet = wallet;
    this.hermes = hermes;
    this.at = at;
    this.policy = policy;
    this.log = log;
    this.#nextBlock = state.nextBlock;
    this.#lastBlockHash = state.poolIds === undefined ? undefined : state.lastBlockHash;
    for (const id of state.poolIds ?? []) this.#poolIds.add(id);
    for (const r of state.open) this.#open.set(recordKey(r), r);
  }

  /** Native token the keeper paid for gas in the last `windowSeconds`, for the balance alert (spec §15.6). */
  spentSince(windowSeconds: number, nowSeconds = Math.floor(Date.now() / 1000)): bigint {
    const from = nowSeconds - windowSeconds;
    while (this.#spend.length > 0 && this.#spend[0]!.t < from) this.#spend.shift();
    return this.#spend.reduce((sum, e) => sum + e.wei, 0n);
  }

  /** Waits for a transaction and records what its gas cost, whatever its status. */
  async #confirm(hash: `0x${string}`) {
    const receipt = await this.client.waitForTransactionReceipt({ hash });
    this.#spend.push({ t: Math.floor(Date.now() / 1000), wei: receipt.gasUsed * receipt.effectiveGasPrice });
    return receipt;
  }

  state(): KeeperState {
    return { nextBlock: this.#nextBlock, open: [...this.#open.values()], poolIds: [...this.#poolIds], ...(this.#lastBlockHash === undefined ? {} : { lastBlockHash: this.#lastBlockHash }) };
  }

  openRecords(): TouchstoneRecord[] {
    return [...this.#open.values()];
  }

  async tick(): Promise<TickReport> {
    const report: TickReport = { ingested: 0, settled: 0, expired: 0, closedElsewhere: 0, dripped: 0, pushed: 0, accrued: 0 };
    // viem caches the block number for a few seconds by default; a stale head means a stale clock.
    const head = await this.client.getBlockNumber({ cacheTime: 0 });
    const headBlock = await this.client.getBlock({ blockNumber: head });
    if (this.#nextBlock > this.policy.startBlock) {
      const previous = this.#nextBlock - 1n;
      const changed = previous > head || this.#lastBlockHash === undefined
        || (await this.client.getBlock({ blockNumber: previous })).hash !== this.#lastBlockHash;
      if (changed) {
        this.log("warn", "canonical cursor changed or lacks an anchor; rescanning", { from: this.policy.startBlock });
        this.#nextBlock = this.policy.startBlock;
        this.#open.clear();
        this.#windows.clear();
        this.#pools.clear();
        this.#poolIds.clear();
        this.#lastDrip.clear();
        this.#lastAccrue.clear();
        this.#lastBlockHash = undefined;
      }
    }
    report.ingested = await this.#ingest(head);
    // Anchor only a complete, internally consistent scan. A mid-scan reorg is retried from the start.
    const checked = await this.client.getBlock({ blockNumber: head });
    if (checked.hash !== headBlock.hash) {
      this.#lastBlockHash = undefined;
      throw new Error("chain reorganized during keeper ingestion");
    }
    this.#lastBlockHash = headBlock.hash;
    const now = Number(headBlock.timestamp);
    for (const r of [...this.#open.values()]) {
      const outcome = await this.#process(r, now);
      if (outcome === "settled") report.settled++;
      if (outcome === "expired") report.expired++;
      if (outcome === "closed") report.closedElsewhere++;
    }
    for (const id of this.#poolIds) {
      try { await this.#pool(id); }
      catch (err) { this.log("warn", "pool discovery failed", { poolId: id, error: errorText(err) }); }
    }
    report.accrued = await this.#housekeepAccrue(now);
    report.dripped = await this.#housekeepDrip(now);
    report.pushed = await this.#housekeepPush();
    return report;
  }

  // Step 1: ingest DepositTaken. The event carries the whole record, so no storage reads are needed.
  async #ingest(head: bigint): Promise<number> {
    let n = 0;
    while (this.#nextBlock <= head) {
      const to = this.#nextBlock + this.policy.logBlockRange - 1n < head ? this.#nextBlock + this.policy.logBlockRange - 1n : head;
      const logs = await this.client.getContractEvents({
        address: this.at.hook,
        abi: touchstoneHookAbi,
        eventName: "DepositTaken",
        fromBlock: this.#nextBlock,
        toBlock: to,
      });
      const registrations = await this.client.getContractEvents({
        address: this.at.factory, abi: touchstoneFactoryAbi, eventName: "PoolRegistered",
        fromBlock: this.#nextBlock, toBlock: to,
      });
      for (const l of registrations) if (l.args.id !== undefined) this.#poolIds.add(l.args.id);
      for (const l of logs) {
        const r = decodeDepositTaken(l);
        if (r === null || this.#open.has(recordKey(r))) continue;
        this.#open.set(recordKey(r), r);
        n++;
        this.log("info", "record ingested", { poolId: r.poolId, recordId: r.id.toString(), deposit: r.deposit.toString() });
      }
      this.#nextBlock = to + 1n;
    }
    return n;
  }

  async #process(r: TouchstoneRecord, now: number): Promise<"settled" | "expired" | "closed" | "waiting"> {
    try {
      const hash = await this.client.readContract({
        address: this.at.hook,
        abi: touchstoneHookAbi,
        functionName: "recordHash",
        args: [r.poolId, r.id],
      });
      if (BigInt(hash) === 0n) {
        this.#close(r, "closed elsewhere");
        return "closed";
      }
      const w = await this.#window(r);
      const action = nextAction(w, BigInt(now));
      if (action.kind === "settle") return (await this.#settle(r, w)) ? "settled" : "waiting";
      if (action.kind === "expire") return (await this.#expire(r)) ? "expired" : "waiting";
    } catch (err) {
      if (err instanceof HermesError && err.retriable) {
        this.log("info", "pyth update not available yet", { recordId: r.id.toString(), reason: err.message });
      } else if (revertName(err) === "Touchstone__RecordClosed") {
        this.#close(r, "closed elsewhere");
        return "closed";
      } else {
        this.log("error", "record processing failed", { recordId: r.id.toString(), error: errorText(err) });
      }
    }
    return "waiting";
  }

  // Step 2: the window always comes from the Settler, so calendar rules live in one place.
  async #window(r: TouchstoneRecord): Promise<SettleWindow> {
    const k = recordKey(r);
    const cached = this.#windows.get(k);
    if (cached !== undefined) return cached;
    const [t0, latest, expiresAt] = await this.client.readContract({
      address: this.at.settler,
      abi: settlerAbi,
      functionName: "settleTime",
      args: [r],
    });
    const w = { t0, latest, expiresAt };
    this.#windows.set(k, w);
    return w;
  }

  // Steps 3 and 4: fetch the first base and quote updates at or after t0, price the call, send if worth it.
  async #settle(r: TouchstoneRecord, w: SettleWindow): Promise<boolean> {
    const pool = await this.#pool(r.poolId);
    const t0 = Number(w.t0);
    const base = await this.hermes.firstAtOrAfter(pool.basePriceId, t0);
    const quote = await this.hermes.firstAtOrAfter(pool.quotePriceId, t0);
    if (BigInt(base.publishTime) > w.latest || BigInt(quote.publishTime) > w.latest) {
      // No usable update inside the window: the record can only expire.
      this.log("warn", "first update is past the latest usable time", { recordId: r.id.toString() });
      return false;
    }
    const update = [base.data, quote.data];
    const fee = await this.client.readContract({
      address: await this.#pythAddress(),
      abi: pythAbi,
      functionName: "getUpdateFee",
      args: [update],
    });
    const sim = await this.client.simulateContract({
      account: this.wallet.account,
      address: this.at.settler,
      abi: settlerAbi,
      functionName: "settle",
      args: [r, update],
      value: fee,
    });
    const payout = sim.result;
    const retains = payout.toProtocol + payout.toRebatePool + payout.toLPs > 0n;
    const estimate = () =>
      this.client.estimateContractGas({
        account: this.wallet.account,
        address: this.at.settler,
        abi: settlerAbi,
        functionName: "settle",
        args: [r, update],
        value: fee,
      });
    const worthIt = await this.#profitable(r, pool, payout.tip, base, quote, estimate, fee);
    const atLoss = this.policy.settleAtLoss && (retains || (payout.benign && payout.rebate === 0n));
    if (!worthIt && !atLoss) {
      this.log("info", "settlement not worth sending; leaving it to others or to expiry", { recordId: r.id.toString() });
      return false;
    }
    const tx = await this.wallet.writeContract(sim.request);
    const receipt = await this.#confirm(tx);
    if (receipt.status !== "success") throw new Error(`settle reverted in ${tx}`);
    this.#close(r, "settled");
    this.log("info", "settled", { recordId: r.id.toString(), tx, tip: payout.tip.toString(), refund: payout.refund.toString() });
    return true;
  }

  // Step 5: after the window, the record can only expire. Expiry pays no tip; it is a service to traders.
  async #expire(r: TouchstoneRecord): Promise<boolean> {
    const sim = await this.client.simulateContract({
      account: this.wallet.account,
      address: this.at.settler,
      abi: settlerAbi,
      functionName: "expire",
      args: [r],
    });
    const tx = await this.wallet.writeContract(sim.request);
    const receipt = await this.#confirm(tx);
    if (receipt.status !== "success") throw new Error(`expire reverted in ${tx}`);
    this.#close(r, "expired");
    this.log("info", "expired", { recordId: r.id.toString(), tx });
    return true;
  }

  /** Tip value against gas cost, both in USD from Pyth prices, with the configured margin. */
  async #profitable(
    r: TouchstoneRecord,
    pool: PoolInfo,
    tip: bigint,
    base: PythUpdate,
    quote: PythUpdate,
    estimateGas: () => Promise<bigint>,
    oracleFee: bigint,
  ): Promise<boolean> {
    if (tip === 0n) return false;
    const depositIsQuote = r.depositIn0 === pool.quoteIs0;
    const decimals = r.depositIn0 ? pool.decimals0 : pool.decimals1;
    const tipUsd = (Number(tip) / 10 ** decimals) * toFloat(depositIsQuote ? quote : base);
    const [gas, gasPrice, native] = await Promise.all([
      estimateGas(),
      this.client.getGasPrice(),
      this.hermes.latest(this.policy.nativePriceId),
    ]);
    const costUsd = (Number(gas * gasPrice + oracleFee) / 1e18) * toFloat(native);
    return Number.isFinite(tipUsd) && Number.isFinite(costUsd) && tipUsd > 0 && costUsd >= 0
      && tipUsd * 10_000 >= costUsd * (10_000 + this.policy.minMarginBps);
  }

  // Step 7: drip about dripsPerPeriod times per vesting period, on pools that have something vesting.
  async #housekeepDrip(now: number): Promise<number> {
    let n = 0;
    for (const [id, pool] of this.#pools) {
      const interval = Math.max(1, Math.floor(pool.vestPeriod / this.policy.dripsPerPeriod));
      if (now - (this.#lastDrip.get(id) ?? 0) < interval) continue;
      try {
        const st = await this.client.readContract({ address: this.at.hook, abi: touchstoneHookAbi, functionName: "poolState", args: [id] });
        if (st.vest0 + st.vest1 === 0n) continue;
        const sim = await this.client.simulateContract({
          account: this.wallet.account,
          address: this.at.hook,
          abi: touchstoneHookAbi,
          functionName: "drip",
          args: [pool.key],
        });
        const receipt = await this.#confirm(await this.wallet.writeContract(sim.request));
        if (receipt.status !== "success") throw new Error("housekeeping transaction reverted");
        this.#lastDrip.set(id, now);
        n++;
      } catch (err) {
        this.log("warn", "drip failed", { poolId: id, error: errorText(err) });
      }
    }
    return n;
  }

  // Plain transactions keep accrual outside any PoolManager unlock; no keeper tip is paid.
  async #housekeepAccrue(now: number): Promise<number> {
    const licence = this.at.licence;
    const interval = this.policy.accrueIntervalS;
    if (licence === undefined || interval === undefined) return 0;
    let count = 0;
    for (const [id, pool] of this.#pools) {
      if (!pool.licensed || now - (this.#lastAccrue.get(id) ?? -interval) < interval) continue;
      // Bound failed attempts too: an unavailable auction must not burn gas on every poll.
      this.#lastAccrue.set(id, now);
      try {
        // Decide by what accrue would charge, not by leases(): leases() applies transitions in memory, so a holder
        // that lapsed since the last accrual already reads as absent while its charged rent and remainder still
        // wait in the auction.
        const sim = await this.client.simulateContract({ account: this.wallet.account, address: licence, abi: licenceAuctionAbi, functionName: "accrue", args: [id] });
        if (sim.result === 0n) continue;
        const receipt = await this.#confirm(await this.wallet.writeContract(sim.request));
        if (receipt.status !== "success") throw new Error("accrual transaction reverted");
        count++;
      } catch (err) {
        this.log("warn", "accrue failed", { poolId: id, error: errorText(err) });
      }
    }
    return count;
  }

  async #housekeepPush(): Promise<number> {
    let n = 0;
    const currencies = new Set<Address>();
    for (const p of this.#pools.values()) {
      currencies.add(p.currency0);
      currencies.add(p.currency1);
    }
    for (const recipient of this.policy.pushRecipients) {
      for (const c of currencies) {
        try {
          const owed = await this.client.readContract({ address: this.at.ledger, abi: rebateLedgerAbi, functionName: "owed", args: [recipient, c] });
          if (owed === 0n) continue;
          const sim = await this.client.simulateContract({
            account: this.wallet.account,
            address: this.at.ledger,
            abi: rebateLedgerAbi,
            functionName: "push",
            args: [recipient, c],
          });
          const receipt = await this.#confirm(await this.wallet.writeContract(sim.request));
        if (receipt.status !== "success") throw new Error("housekeeping transaction reverted");
          n++;
        } catch (err) {
          this.log("warn", "push failed", { recipient, currency: c, error: errorText(err) });
        }
      }
    }
    return n;
  }

  async #pool(id: Hex): Promise<PoolInfo> {
    const cached = this.#pools.get(id);
    if (cached !== undefined) return cached;
    const [cfg, key] = await Promise.all([
      this.client.readContract({ address: this.at.factory, abi: touchstoneFactoryAbi, functionName: "poolConfig", args: [id] }),
      this.client.readContract({ address: this.at.hook, abi: touchstoneHookAbi, functionName: "poolKey", args: [id] }),
    ]);
    const info: PoolInfo = {
      licensed: (cfg.flags & 2) !== 0,
      basePriceId: cfg.basePriceId,
      quotePriceId: cfg.quotePriceId,
      quoteIs0: (cfg.flags & 1) === 1,
      decimals0: cfg.decimals0,
      decimals1: cfg.decimals1,
      vestPeriod: cfg.vestPeriod,
      currency0: key.currency0,
      currency1: key.currency1,
      key: { currency0: key.currency0, currency1: key.currency1, fee: key.fee, tickSpacing: key.tickSpacing, hooks: key.hooks },
    };
    this.#pools.set(id, info);
    return info;
  }

  async #pythAddress(): Promise<Address> {
    this.#pyth ??= await this.client.readContract({ address: this.at.settler, abi: settlerPythAbi, functionName: "PYTH" });
    return this.#pyth;
  }

  #close(r: TouchstoneRecord, why: string): void {
    this.#open.delete(recordKey(r));
    this.#windows.delete(recordKey(r));
    this.log("info", "record closed", { recordId: r.id.toString(), why });
  }
}

/** The custom error name inside a viem contract error, if any. */
export function revertName(err: unknown): string | undefined {
  if (!(err instanceof BaseError)) return undefined;
  const reverted = err.walk((e) => e instanceof ContractFunctionRevertedError);
  return reverted instanceof ContractFunctionRevertedError ? reverted.data?.errorName : undefined;
}

const errorText = (err: unknown): string => (err instanceof BaseError ? err.shortMessage : err instanceof Error ? err.message : String(err));
