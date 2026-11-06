import { afterEach, describe, expect, it, vi } from "vitest";
import type { Address, PublicClient } from "viem";
import { Indexer, type IndexerConfig } from "../src/indexer.ts";
import { Store } from "../src/store.ts";
import type { TouchstoneRecord } from "@touchstone/shared";

const address = (n: number): Address => `0x${n.toString(16).padStart(40, "0")}`;
const cfg: IndexerConfig = {
  chain: "c", hook: address(1), settler: address(2), ledger: address(3), factory: address(4),
  poolManager: address(5), confirmations: 2n, startBlock: 5n, blockRange: 50n,
};
const record: TouchstoneRecord = {
  poolId: "0xaa", id: 7n, deposit: 100n, depositIn0: true, beneficiary: address(9),
  timestamp: 1_000, mode: 0, licenceActive: false, byHolder: false, zeroForOne: true,
  sender: address(8), rebateTo: address(9), amount0: -1_000n, amount1: 1_000n,
  sqrtPriceBeforeX96: 1n << 96n, sqrtPriceAfterX96: 1n << 96n, liquidityBefore: 1_000n,
  swapFeePips: 500,
};
const log = (name: string, block: bigint, index: number, at = cfg.settler) => ({
  eventName: name, blockNumber: block, logIndex: index, transactionHash: `0x${block}${index}`,
  address: at, args: { id: record.poolId, recordId: record.id }, data: "0x", topics: [],
});
const stores: Store[] = [];
afterEach(() => { for (const s of stores.splice(0)) s.close(); });
function setup() {
  const store = new Store(":memory:"); stores.push(store);
  const client = {
    getBlockNumber: vi.fn().mockResolvedValue(20n),
    getBlock: vi.fn().mockImplementation(async ({ blockNumber }: { blockNumber: bigint }) => ({ hash: `0x${blockNumber}`, timestamp: 1000n + blockNumber })),
    getContractEvents: vi.fn().mockResolvedValue([]), getLogs: vi.fn().mockResolvedValue([]),
  };
  return { store, client, indexer: new Indexer(client as unknown as PublicClient, store, cfg, () => undefined) };
}

describe("Indexer recovery", () => {
  it("writes logs in block/log order across contracts and preserves both closure outcomes", async () => {
    const { store, client, indexer } = setup();
    store.openRecord("c", 5n, record);
    store.openRecord("c", 5n, { ...record, id: 8n });
    const expired = { ...log("Expired", 7n, 2), args: { id: record.poolId, recordId: 8n } };
    client.getContractEvents.mockImplementation(async ({ address: at, eventName }: { address: Address; eventName: string }) =>
      (at === cfg.hook ? [log("RefundDeferred", 8n, 1, cfg.hook)] : at === cfg.settler ? [log("Settled", 8n, 2), expired] : []).filter((event) => event.eventName === eventName));
    const writes = vi.spyOn(store, "addEvent");
    await indexer.tick();
    expect(writes.mock.calls.map(([e]) => e.name)).toEqual(["Expired", "RefundDeferred", "Settled"]);
    expect(store.countByStatus("c")).toEqual({ settled: 1, expired: 1 });
  });

  it("does not keep registration writes when a later RPC request fails", async () => {
    const { store, client, indexer } = setup();
    client.getContractEvents.mockImplementation(async ({ address: at }: { address: Address }) => {
      if (at === cfg.factory) return [log("PoolRegistered", 6n, 0, cfg.factory)];
      throw new Error("RPC unavailable");
    });
    await expect(indexer.tick()).rejects.toThrow("RPC unavailable");
    expect(store.pools("c")).toEqual([]);
    expect(store.cursor("c")).toBeNull();
  });

  it("rolls back raw and derived writes if a later event cannot be applied", async () => {
    const { store, client, indexer } = setup();
    store.openRecord("c", 5n, record);
    client.getContractEvents.mockImplementation(async ({ address: at }: { address: Address }) =>
      at === cfg.settler ? [log("Settled", 7n, 0), { ...log("Expired", 8n, 0), args: {} }] : []);
    await expect(indexer.tick()).rejects.toThrow();
    expect(store.countEvents("c", "Settled")).toBe(0);
    expect(store.countByStatus("c")).toEqual({ open: 1 });
    expect(store.cursor("c")).toBeNull();
  });

  it("rolls back derived state when the cursor write fails", async () => {
    const { store, client, indexer } = setup();
    store.openRecord("c", 5n, record);
    client.getContractEvents.mockImplementation(async ({ address: at }: { address: Address }) =>
      at === cfg.settler ? [log("Settled", 7n, 0)] : []);
    vi.spyOn(store, "setCursor").mockImplementation(() => { throw new Error("disk write failed"); });
    await expect(indexer.tick()).rejects.toThrow("disk write failed");
    expect(store.countEvents("c", "Settled")).toBe(0);
    expect(store.countByStatus("c")).toEqual({ open: 1 });
  });

  it("does not write a range whose anchor changed during RPC reads", async () => {
    const { store, client, indexer } = setup();
    client.getBlock.mockResolvedValueOnce({ hash: "0xold" }).mockResolvedValueOnce({ hash: "0xnew" });
    await expect(indexer.tick()).rejects.toThrow("chain changed");
    expect(store.cursor("c")).toBeNull();
  });

  it("rescans from configured start after a reorg deeper than twice the confirmation depth", async () => {
    const { store, client, indexer } = setup();
    store.addEvent({ chain: "c", txHash: "0xold", logIndex: 0, blockNumber: 6n, contract: cfg.hook, name: "OldFork", args: {} });
    store.setCursor("c", 19n, "0xoldtip");
    const result = await indexer.tick();
    expect(result?.from).toBe(cfg.startBlock);
    expect(store.countEvents("c", "OldFork")).toBe(0);
    expect(client.getContractEvents).toHaveBeenCalledWith(expect.objectContaining({ fromBlock: cfg.startBlock }));
  });

  it("recovers when the saved cursor is above the current head", async () => {
    const { store, client, indexer } = setup();
    store.setCursor("c", 30n, "0xoldtip");
    client.getBlock.mockImplementation(async ({ blockNumber }: { blockNumber: bigint }) => {
      if (blockNumber > 20n) throw new Error("block not found");
      return { hash: `0x${blockNumber}` };
    });
    expect((await indexer.tick())?.from).toBe(cfg.startBlock);
  });

  it("invalidates the old cursor even if the rescan RPC subsequently fails", async () => {
    const { store, client, indexer } = setup();
    store.setCursor("c", 19n, "0xoldtip");
    client.getContractEvents.mockRejectedValue(new Error("RPC unavailable"));
    await expect(indexer.tick()).rejects.toThrow("RPC unavailable");
    expect(store.cursor("c")).toBeNull();
  });

  it("does not mask a reorg between ranges with a new canonical cursor", async () => {
    const { store, client } = setup();
    const indexer = new Indexer(client as unknown as PublicClient, store, { ...cfg, blockRange: 5n }, () => undefined);
    let reorg = false;
    let readsAtNine = 0;
    client.getBlock.mockImplementation(async ({ blockNumber }: { blockNumber: bigint }) => {
      if (blockNumber === 9n && ++readsAtNine > 2) reorg = true;
      return { hash: `${reorg || blockNumber > 9n ? "0xnew" : "0xold"}${blockNumber}` };
    });
    client.getContractEvents.mockImplementation(async ({ address: at, fromBlock }: { address: Address; fromBlock: bigint }) =>
      at === cfg.hook && fromBlock === 5n && !reorg ? [log("OldFork", 6n, 0, cfg.hook)] : []);
    await expect(indexer.tick()).rejects.toThrow("indexed boundary changed");
    expect(store.cursor("c")).toEqual({ nextBlock: 10n, lastHash: "0xold9" });
    await indexer.tick();
    expect(store.countEvents("c", "OldFork")).toBe(0);
  });

  it("rechecks the initial saved boundary after fetching the first range", async () => {
    const { store, client, indexer } = setup();
    store.setCursor("c", 10n, "0xold9");
    let previousReads = 0;
    client.getBlock.mockImplementation(async ({ blockNumber }: { blockNumber: bigint }) => ({
      hash: blockNumber === 9n ? (++previousReads === 1 ? "0xold9" : "0xnew9") : `0xnew${blockNumber}`,
    }));
    client.getContractEvents.mockImplementation(async ({ address: at }: { address: Address }) =>
      at === cfg.hook ? [log("NewFork", 11n, 0, cfg.hook)] : []);
    await expect(indexer.tick()).rejects.toThrow("indexed boundary changed");
    expect(store.cursor("c")).toEqual({ nextBlock: 10n, lastHash: "0xold9" });
    expect(store.countEvents("c", "NewFork")).toBe(0);
  });
});

describe("auction ingestion", () => {
  it("uses one event and address per request and stores auction events idempotently", async () => {
    const { store, client } = setup();
    const licence = address(6);
    const indexer = new Indexer(client as unknown as PublicClient, store, { ...cfg, licence }, () => undefined);
    client.getContractEvents.mockImplementation(async ({ address: at, eventName }: { address: Address; eventName: string }) =>
      at === licence && eventName === "RentCharged" ? [{ ...log("RentCharged", 8n, 1, licence), args: { id: record.poolId, amount: 7n } }] : []);
    await indexer.tick();
    expect(store.countEvents("c", "RentCharged")).toBe(1);
    for (const [request] of client.getContractEvents.mock.calls) {
      expect(request).toEqual(expect.objectContaining({ eventName: expect.any(String), address: expect.any(String) }));
    }
    await indexer.tick();
    expect(store.countEvents("c", "RentCharged")).toBe(1);
  });
});
