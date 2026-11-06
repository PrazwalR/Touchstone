import { describe, expect, it, vi } from "vitest";
import type { Account, Chain, PublicClient, Transport, WalletClient } from "viem";
import type { TouchstoneRecord } from "@touchstone/shared";
import { Keeper } from "../src/keeper.ts";
import { Hermes } from "../src/hermes.ts";
const address = `0x${"11".repeat(20)}` as const;
const id = `0x${"22".repeat(32)}` as const;
const hash = `0x${"33".repeat(32)}` as const;
const record = { poolId: id, id: 1n, timestamp: 97, depositIn0: true } as TouchstoneRecord;
function setup(fee = 0n, records = [record], licensed = false) {
  const readContract = vi.fn(async ({ functionName }: { functionName: string }): Promise<unknown> => {
    switch (functionName) {
      case "recordHash": return hash;
      case "settleTime": return [100n, 110n, 200n];
      case "poolConfig": return { basePriceId: id, quotePriceId: id, flags: licensed ? 3 : 1, decimals0: 18, decimals1: 18, vestPeriod: 60 };
      case "poolKey": return { currency0: address, currency1: address, fee: 500, tickSpacing: 60, hooks: address };
      case "PYTH": return address;
      case "getUpdateFee": return fee;
      case "poolState": return { vest0: 0n, vest1: 0n };
      default: throw new Error(functionName);
    }
  });
  const client = {
    getBlockNumber: vi.fn(async () => 10n),
    getBlock: vi.fn(async (): Promise<{ timestamp: bigint; hash: string }> => ({ timestamp: 120n, hash })),
    getContractEvents: vi.fn(async (): Promise<unknown[]> => []), readContract,
    simulateContract: vi.fn(async ({ functionName }: { functionName: string }): Promise<{ result: unknown; request: object }> =>
      functionName === "accrue"
        ? { result: 600n, request: {} }
        : { result: { refund: 0n, tip: 10n ** 18n, toProtocol: 0n, toRebatePool: 0n, toLPs: 1n, rebate: 0n, benign: false }, request: {} }),
    estimateContractGas: vi.fn(async () => 1n), getGasPrice: vi.fn(async () => 1n),
    waitForTransactionReceipt: vi.fn(async () => ({ status: "success" })),
  };
  const wallet = { account: { address }, writeContract: vi.fn(async () => hash) };
  const update = { id, data: "0x1234", price: 100_000_000n, conf: 0n, expo: -8, publishTime: 100 };
  const hermes = { firstAtOrAfter: vi.fn(async () => update), latest: vi.fn(async () => update) };
  const keeper = new Keeper(client as unknown as PublicClient<Transport, Chain>, wallet as unknown as WalletClient<Transport, Chain, Account>, hermes as unknown as Hermes,
    { hook: address, settler: address, factory: address, ledger: address, ...(licensed ? { licence: address } : {}) },
    { ...(licensed ? { accrueIntervalS: 60 } : {}), minMarginBps: 0, settleAtLoss: false, logBlockRange: 100n, dripsPerPeriod: 10, nativePriceId: id, pushRecipients: [], startBlock: 0n },
    { nextBlock: 0n, open: records }, () => undefined);
  return { keeper, client, wallet, readContract };
}
describe("keeper recovery and settlement", () => {
  it("checkpoints a bounded scan at its own block hash and uses the actual head time", async () => {
    const { keeper, client } = setup();
    client.getBlock.mockImplementation(async (...args: unknown[]) => {
      const number = (args[0] as { blockNumber: bigint }).blockNumber;
      return { timestamp: number === 10n ? 120n : 90n, hash: `0x${number.toString(16).padStart(64, "0")}` };
    });
    expect((await keeper.tick({ maxBlocks: 3n, maxRecords: 1, housekeeping: false })).settled).toBe(1);
    expect(keeper.state().nextBlock).toBe(3n);
    expect(keeper.state().lastBlockHash).toBe(`0x${"2".padStart(64, "0")}`);
    await keeper.tick({ maxBlocks: 3n, maxRecords: 1, housekeeping: false });
    expect(keeper.state().nextBlock).toBe(6n);
    expect(client.getContractEvents).toHaveBeenLastCalledWith(expect.objectContaining({ fromBlock: 3n, toBlock: 5n }));
  });
  it("rotates waiting records across bounded ticks instead of starving later records", async () => {
    const { keeper, readContract, wallet } = setup(0n, [record, { ...record, id: 2n }]);
    const original = readContract.getMockImplementation()!;
    readContract.mockImplementation(async args => args.functionName === "settleTime" ? [130n, 140n, 200n] : original(args));
    await keeper.tick({ maxRecords: 1, housekeeping: false });
    expect(keeper.openRecords().map(r => r.id)).toEqual([2n, 1n]);
    await keeper.tick({ maxRecords: 1, housekeeping: false });
    expect(keeper.openRecords().map(r => r.id)).toEqual([1n, 2n]);
    expect(wallet.writeContract).not.toHaveBeenCalled();
  });
  it("can skip housekeeping on the serverless settlement path", async () => {
    const { keeper, client } = setup(0n, [], true);
    await keeper.tick({ housekeeping: false });
    expect(client.simulateContract).not.toHaveBeenCalled();
  });
  it("submits a timely published update after latest, before expiry", async () => {
    const { keeper, wallet } = setup();
    expect((await keeper.tick()).settled).toBe(1);
    expect(wallet.writeContract).toHaveBeenCalledOnce();
  });
  it("includes the oracle fee in profitability", async () => {
    const { keeper, client, wallet } = setup(2n * 10n ** 18n);
    client.getBlock.mockResolvedValue({ timestamp: 105n, hash });
    expect((await keeper.tick()).settled).toBe(0);
    expect(wallet.writeContract).not.toHaveBeenCalled();
  });
  it("continues after a record read failure", async () => {
    const { keeper, client, readContract } = setup(0n, [record, { ...record, id: 2n }]);
    client.getBlock.mockResolvedValue({ timestamp: 105n, hash });
    readContract.mockRejectedValueOnce(new Error("temporary rpc failure"));
    expect((await keeper.tick()).settled).toBe(1);
    expect(keeper.openRecords()).toHaveLength(1);
  });
  it("discovers and persists pools for housekeeping without open records", async () => {
    const { keeper, client, readContract } = setup(0n, []);
    client.getContractEvents.mockImplementation(async (...args: unknown[]) =>
      (args[0] as { eventName: string }).eventName === "PoolRegistered" ? [{ args: { id } }] : []);
    await keeper.tick();
    expect(keeper.state().poolIds).toEqual([id]);
    expect(readContract).toHaveBeenCalledWith(expect.objectContaining({ functionName: "poolState", args: [id] }));
  });
  it("rescans from the configured start after a canonical hash changes", async () => {
    const { keeper, client } = setup(0n, []);
    await keeper.tick();
    client.getBlockNumber.mockResolvedValue(12n);
    client.getBlock.mockResolvedValue({ timestamp: 121n, hash: `0x${"44".repeat(32)}` });
    await keeper.tick();
    expect(client.getContractEvents).toHaveBeenLastCalledWith(expect.objectContaining({ fromBlock: 0n, toBlock: 12n }));
  });
});

describe("licence accrual housekeeping", () => {
  it("accrues an occupied licence once per configured interval", async () => {
    const { keeper, client, wallet } = setup(0n, [], true);
    client.getContractEvents.mockImplementation(async (...args: unknown[]) =>
      (args[0] as { eventName: string }).eventName === "PoolRegistered" ? [{ args: { id } }] : []);
    expect((await keeper.tick()).accrued).toBe(1);
    expect(client.simulateContract).toHaveBeenCalledWith(expect.objectContaining({ functionName: "accrue", args: [id] }));
    expect((await keeper.tick()).accrued).toBe(0);
    expect(wallet.writeContract).toHaveBeenCalledOnce();
    client.getBlock.mockResolvedValue({ timestamp: 180n, hash });
    expect((await keeper.tick()).accrued).toBe(1);
  });
  it("skips an auction with no rent to charge", async () => {
    const { keeper, client, wallet } = setup(0n, [], true);
    client.getContractEvents.mockImplementation(async (...args: unknown[]) =>
      (args[0] as { eventName: string }).eventName === "PoolRegistered" ? [{ args: { id } }] : []);
    client.simulateContract.mockImplementation(async () => ({ result: 0n, request: {} }));
    expect((await keeper.tick()).accrued).toBe(0);
    expect(wallet.writeContract).not.toHaveBeenCalled();
  });
  it("accrues a lapsed lease whose charged rent is still in the auction", async () => {
    // leases() would read both slots empty here; the simulation still shows rent owed to the hook.
    const { keeper, client, wallet } = setup(0n, [], true);
    client.getContractEvents.mockImplementation(async (...args: unknown[]) =>
      (args[0] as { eventName: string }).eventName === "PoolRegistered" ? [{ args: { id } }] : []);
    expect((await keeper.tick()).accrued).toBe(1);
    expect(wallet.writeContract).toHaveBeenCalledOnce();
  });
});
