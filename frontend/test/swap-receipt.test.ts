import { encodeAbiParameters, encodeEventTopics, parseAbiParameters, type TransactionReceipt } from "viem";
import { describe, expect, it, vi } from "vitest";
import { confirmSwap, executeSwap, poolManagerSwapAbi, swapAmountsFromReceipt, type SwapContext } from "../src/swap/swap.ts";

const ctx = {
  manager: "0x0000000000000000000000000000000000000003",
  router: "0x0000000000000000000000000000000000000004",
  hook: "0x0000000000000000000000000000000000000005",
  poolId: `0x${"11".repeat(32)}`,
  key: { currency0: "0x0000000000000000000000000000000000000000" },
  quote: { address: "0x0000000000000000000000000000000000000002" },
  risky: { address: "0x0000000000000000000000000000000000000000" },
} as unknown as SwapContext;
const hash = `0x${"22".repeat(32)}` as const;
const receipt = (amount0: bigint, amount1: bigint): TransactionReceipt => ({
  status: "success", transactionHash: hash, blockNumber: 12n,
  logs: [{
    address: ctx.manager,
    topics: encodeEventTopics({ abi: poolManagerSwapAbi, eventName: "Swap", args: { id: ctx.poolId, sender: ctx.router } }),
    data: encodeAbiParameters(parseAbiParameters("int128,int128,uint160,uint128,int24,uint24"), [amount0, amount1, 1n << 96n, 1_000n, 0, 500]),
  }],
} as unknown as TransactionReceipt);

const record = (amount0: bigint, amount1: bigint, deposit: bigint, depositIn0: boolean) => ({ amount0, amount1, deposit, depositIn0 });

describe("confirmed receipt amounts", () => {
  it("subtracts an exact-input sell's quote deposit from the actual AMM output", () => {
    expect(swapAmountsFromReceipt(ctx, "sell", receipt(-10n, 1_000n), record(-10n, 1_000n, 30n, false)))
      .toEqual({ paid: 10n, received: 970n });
  });
  it("adds an exact-output sell's risky deposit to its payment", () => {
    expect(swapAmountsFromReceipt(ctx, "sell", receipt(-10n, 1_000n), record(-10n, 1_000n, 2n, true)))
      .toEqual({ paid: 12n, received: 1_000n });
  });
  it("handles native output and input-side quote deposits for buys", () => {
    expect(swapAmountsFromReceipt(ctx, "buy", receipt(10n, -1_000n), record(10n, -1_000n, 1n, true)))
      .toEqual({ paid: 1_000n, received: 9n });
    expect(swapAmountsFromReceipt(ctx, "buy", receipt(10n, -1_000n), record(10n, -1_000n, 5n, false)))
      .toEqual({ paid: 1_005n, received: 10n });
  });
  it("works without a deposit and uses the hook's AMM record if the manager log is unavailable", () => {
    expect(swapAmountsFromReceipt(ctx, "buy", receipt(10n, -1_000n), null)).toEqual({ paid: 1_000n, received: 10n });
    expect(swapAmountsFromReceipt(ctx, "sell", { ...receipt(-10n, 1_000n), logs: [] }, record(-10n, 1_000n, 30n, false)))
      .toEqual({ paid: 10n, received: 970n });
  });
  it("reports a mined swap successfully even when balance RPC methods fail", async () => {
    const calls: string[] = [];
    const brokenBalance = vi.fn().mockRejectedValue(new Error("archive balance unavailable"));
    const client = {
      simulateContract: vi.fn().mockResolvedValue({ request: {}, result: [10n << 128n, 0n] }),
      waitForTransactionReceipt: vi.fn().mockImplementation(async () => { calls.push("receipt"); return receipt(10n, -1_000n); }),
      getBalance: brokenBalance, readContract: brokenBalance,
    } as unknown as SwapContext["client"];
    const wallet = {
      account: { address: "0x0000000000000000000000000000000000000006" },
      writeContract: vi.fn().mockResolvedValue(hash),
    } as unknown as Parameters<typeof executeSwap>[1];
    const result = await executeSwap({ ...ctx, client }, wallet, "buy", 1_000n,
      { maxDeposit: 1n, minNetOut: 9n, minGrossOut: 9n, maxNetIn: 1_000n }, 1_000n, false,
      () => { calls.push("submitted"); });
    expect(result).toMatchObject({ hash, paid: 1_000n, received: 10n, record: null });
    expect(calls).toEqual(["submitted", "receipt"]);
    expect(brokenBalance).not.toHaveBeenCalled();
  });
  it("can resume a submitted transaction after a receipt RPC error without signing again", async () => {
    const wait = vi.fn().mockRejectedValueOnce(new Error("temporary receipt RPC failure"))
      .mockResolvedValueOnce(receipt(10n, -1_000n));
    const client = {
      simulateContract: vi.fn().mockResolvedValue({ request: {}, result: [10n << 128n, 0n] }),
      waitForTransactionReceipt: wait,
    } as unknown as SwapContext["client"];
    const write = vi.fn().mockResolvedValue(hash);
    const wallet = {
      account: { address: "0x0000000000000000000000000000000000000006" }, writeContract: write,
    } as unknown as Parameters<typeof executeSwap>[1];
    const submitted = vi.fn();
    await expect(executeSwap({ ...ctx, client }, wallet, "buy", 1_000n,
      { maxDeposit: 1n, minNetOut: 9n, minGrossOut: 9n, maxNetIn: 1_000n }, 1_000n, false, submitted))
      .rejects.toThrow("temporary receipt RPC failure");
    expect(submitted).toHaveBeenCalledWith(hash);
    expect(await confirmSwap({ ...ctx, client }, "buy", hash)).toMatchObject({ hash, paid: 1_000n, received: 10n });
    expect(write).toHaveBeenCalledTimes(1);
    expect(wait).toHaveBeenNthCalledWith(1, { hash });
    expect(wait).toHaveBeenNthCalledWith(2, { hash });
  });
});
