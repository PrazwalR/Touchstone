import { describe, expect, it, vi } from "vitest";
import { encodeAbiParameters, encodeEventTopics, type Hex } from "viem";
import { touchstoneHookAbi } from "../abi/index.ts";
import { readRecordWindow, readRefundDelivery } from "../src/swap/recordSettlement.ts";
import type { SwapContext } from "../src/swap/swap.ts";

const id = `0x${"01".repeat(32)}` as Hex;
const hash = `0x${"02".repeat(32)}` as Hex;
const hook = "0x0000000000000000000000000000000000000001";
const beneficiary = "0x0000000000000000000000000000000000000002";

describe("record settlement evidence", () => {
  it("uses the full event record and the Settler's closed-market schedule", async () => {
    const record = { poolId: id, id: 3n, mode: 1, timestamp: 100 };
    const getContractEvents = vi.fn().mockResolvedValue([{ args: { record } }]);
    const readContract = vi.fn().mockResolvedValue([90_000n, 93_600n, 176_400n]);
    const ctx = { hook, settler: beneficiary, client: { getContractEvents, readContract } } as unknown as SwapContext;
    expect(await readRecordWindow(ctx, id, 3n, 10n)).toEqual({ t0: 90_000n, latest: 93_600n, expiresAt: 176_400n });
    expect(getContractEvents.mock.calls[0][0]).toMatchObject({ fromBlock: 10n, toBlock: 10n, args: { id, recordId: 3n } });
    expect(readContract.mock.calls[0][0]).toMatchObject({ functionName: "settleTime", args: [record] });
  });
  it("does not invent timing if the deposit event is unavailable", async () => {
    const readContract = vi.fn();
    const ctx = { client: { getContractEvents: async () => [], readContract } } as unknown as SwapContext;
    await expect(readRecordWindow(ctx, id, 3n, 10n)).rejects.toThrow("not available");
    expect(readContract).not.toHaveBeenCalled();
  });
  it("distinguishes a credited refund from successful delivery using the finalization receipt", async () => {
    const log = {
      address: hook,
      topics: encodeEventTopics({ abi: touchstoneHookAbi, eventName: "RefundDeferred", args: { id, recordId: 3n } }),
      data: encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [beneficiary, 123n]),
    };
    const getTransactionReceipt = vi.fn().mockResolvedValue({ status: "success", logs: [log] });
    const ctx = { hook, client: { getTransactionReceipt } } as unknown as SwapContext;
    expect(await readRefundDelivery(ctx, id, 3n, hash)).toBe("deferred");
    expect(await readRefundDelivery(ctx, id, 4n, hash)).toBe("delivered");
    getTransactionReceipt.mockResolvedValue({ status: "reverted", logs: [] });
    await expect(readRefundDelivery(ctx, id, 3n, hash)).rejects.toThrow("did not succeed");
  });
});
