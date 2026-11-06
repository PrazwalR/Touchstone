import { parseAbiItem, type Address, type Hex, type PublicClient } from "viem";
import {
  decodeDepositTaken,
  licenceAuctionAbi,
  rebateLedgerAbi,
  settlerAbi,
  touchstoneFactoryAbi,
  touchstoneHookAbi,
} from "@touchstone/shared";
import type { RawEvent, Store } from "./store.ts";

const poolManagerEvents = [
  parseAbiItem(
    "event Swap(bytes32 indexed id, address indexed sender, int128 amount0, int128 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick, uint24 fee)",
  ),
  parseAbiItem(
    "event ModifyLiquidity(bytes32 indexed id, address indexed sender, int24 tickLower, int24 tickUpper, int256 liquidityDelta, bytes32 salt)",
  ),
  parseAbiItem("event Donate(bytes32 indexed id, address indexed sender, uint256 amount0, uint256 amount1)"),
] as const;

export interface IndexerConfig {
  chain: string;
  licence?: Address;
  hook: Address;
  settler: Address;
  ledger: Address;
  factory: Address;
  poolManager: Address;
  confirmations: bigint;
  startBlock: bigint;
  blockRange: bigint;
}

type Log = (level: "info" | "warn" | "error", msg: string, fields?: Record<string, unknown>) => void;

interface AnyLog {
  transactionHash: Hex | null;
  logIndex: number | null;
  blockNumber: bigint | null;
  address: Address;
  eventName: string;
  args: unknown;
  data: Hex;
  topics: [] | [Hex, ...Hex[]];
}

/**
 * Spec §15.2: every Touchstone event, plus the PoolManager's Swap, ModifyLiquidity and Donate for Touchstone
 * pools, keyed by (chain, transaction hash, log index) and written idempotently, behind a confirmation depth.
 * If the block below the cursor changes hash, a reorg reached past the depth: the store rewinds and re-reads.
 */
export class Indexer {
  private readonly client: PublicClient;
  private readonly store: Store;
  private readonly cfg: IndexerConfig;
  private readonly log: Log;

  constructor(client: PublicClient, store: Store, cfg: IndexerConfig, log: Log) {
    this.client = client;
    this.store = store;
    this.cfg = cfg;
    this.log = log;
  }

  async tick(): Promise<{ from: bigint; to: bigint; events: number } | null> {
    const head = await this.client.getBlockNumber({ cacheTime: 0 });
    const safe = head - this.cfg.confirmations;
    let from = await this.#resume(head);
    if (safe < from) return null;
    const start = from;
    let events = 0;
    while (from <= safe) {
      const to = from + this.cfg.blockRange - 1n < safe ? from + this.cfg.blockRange - 1n : safe;
      const cursor = this.store.cursor(this.cfg.chain);
      const before = await this.client.getBlock({ blockNumber: to });
      const logs = await this.#range(from, to);
      // Only closure blocks need timestamps; serialize requests to respect public RPC rate limits.
      const headers = new Map<bigint, { hash: Hex; timestamp: bigint }>();
      for (const l of logs) {
        if ((l.eventName === "Settled" || l.eventName === "Expired") && l.blockNumber !== null && !headers.has(l.blockNumber)) {
          const h = await this.client.getBlock({ blockNumber: l.blockNumber });
          if (h.hash === null || typeof h.timestamp !== "bigint") throw new Error("closure block header unavailable");
          headers.set(l.blockNumber, { hash: h.hash, timestamp: h.timestamp });
        }
      }
      const block = await this.client.getBlock({ blockNumber: to });
      if (before.hash !== block.hash) throw new Error("chain changed while reading indexer range; retrying next tick");
      // An unchanged new tip must not hide a reorg of an earlier range committed in this tick.
      if (cursor !== null) {
        const previous = await this.client.getBlock({ blockNumber: cursor.nextBlock - 1n });
        if (previous.hash.toLowerCase() !== cursor.lastHash) throw new Error("indexed boundary changed while reading range; retrying next tick");
      }
      events += this.store.transaction(() => {
        for (const [number, header] of headers) this.store.saveBlock(this.cfg.chain, number, header.hash, header.timestamp);
        let written = 0;
        for (const l of logs) if (this.#write(l)) written++;
        this.store.setCursor(this.cfg.chain, to + 1n, block.hash);
        return written;
      });
      from = to + 1n;
    }
    this.log("info", "indexed", { from: start, to: safe, events });
    return { from: start, to: safe, events };
  }

  async #resume(head: bigint): Promise<bigint> {
    const c = this.store.cursor(this.cfg.chain);
    if (c === null) return this.cfg.startBlock;
    if (c.nextBlock - 1n <= head) {
      const last = await this.client.getBlock({ blockNumber: c.nextBlock - 1n });
      if (last.hash.toLowerCase() === c.lastHash) return c.nextBlock;
    }
    // One tip hash cannot establish an earlier common ancestor. Re-read the configured history safely.
    this.log("warn", "indexed history changed; rescanning from start", { from: c.nextBlock, to: this.cfg.startBlock });
    this.store.rewind(this.cfg.chain, this.cfg.startBlock);
    return this.cfg.startBlock;
  }

  async #range(fromBlock: bigint, toBlock: bigint): Promise<AnyLog[]> {
    // Registrations first, so a pool created in this range has its PoolManager events read too.
    // A single event/address per call avoids multi-value public RPC filter limits.
    const readEvents = async (address: Address, abi: import("viem").Abi): Promise<AnyLog[]> => {
      const result: AnyLog[] = [];
      for (const item of abi) {
        if (item.type !== "event") continue;
        result.push(...await this.client.getContractEvents({ address, abi: [item], eventName: item.name, fromBlock, toBlock }) as unknown as AnyLog[]);
      }
      return result;
    };
    const factory = await readEvents(this.cfg.factory, touchstoneFactoryAbi);
    const hook = await readEvents(this.cfg.hook, touchstoneHookAbi);
    const settler = await readEvents(this.cfg.settler, settlerAbi);
    const ledger = await readEvents(this.cfg.ledger, rebateLedgerAbi);
    const auction = this.cfg.licence === undefined ? [] : await readEvents(this.cfg.licence, licenceAuctionAbi);
    const pools = [...new Set([
      ...this.store.pools(this.cfg.chain),
      ...factory.filter((l) => l.eventName === "PoolRegistered").map((l) => (l.args as { id: Hex }).id),
    ])] as Hex[];
    const pm: AnyLog[] = [];
    if (pools.length > 0) {
      for (const event of poolManagerEvents) {
        for (const id of pools) {
          const logs = await this.client.getLogs({ address: this.cfg.poolManager, event, args: { id }, fromBlock, toBlock });
          pm.push(...(logs as unknown as AnyLog[]));
        }
      }
    }
    const all = [...factory, ...hook, ...settler, ...ledger, ...auction, ...pm] as unknown as AnyLog[];
    return all.filter((l): l is AnyLog & { blockNumber: bigint; logIndex: number } => l.blockNumber !== null && l.logIndex !== null).sort((a, b) => {
      if (a.blockNumber !== b.blockNumber) return a.blockNumber < b.blockNumber ? -1 : 1;
      return a.logIndex - b.logIndex;
    });
  }

  #write(l: AnyLog): boolean {
    if (l.transactionHash === null || l.logIndex === null || l.blockNumber === null) return false;
    const e: RawEvent = {
      chain: this.cfg.chain,
      txHash: l.transactionHash,
      logIndex: l.logIndex,
      blockNumber: l.blockNumber,
      contract: l.address,
      name: l.eventName,
      args: (l.args ?? {}) as Record<string, unknown>,
    };
    if (!this.store.addEvent(e)) return false;
    if (l.eventName === "PoolRegistered") {
      this.store.addPool(this.cfg.chain, (l.args as { id: Hex }).id, l.blockNumber);
    } else if (l.eventName === "DepositTaken") {
      const r = decodeDepositTaken({ data: l.data, topics: l.topics });
      if (r !== null) this.store.openRecord(this.cfg.chain, l.blockNumber, r);
    } else if (l.eventName === "Settled" || l.eventName === "Expired") {
      const a = l.args as { id: Hex; recordId: bigint };
      this.store.closeRecord(this.cfg.chain, a.id, a.recordId, l.eventName === "Settled" ? "settled" : "expired", l.blockNumber);
    } else if (l.eventName === "RefundDeferred") {
      const a = l.args as { id: Hex; recordId: bigint };
      this.store.markDeferred(this.cfg.chain, a.id, a.recordId);
    }
    return true;
  }
}
