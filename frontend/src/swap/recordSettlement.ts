import { decodeEventLog, type Hex, type TransactionReceipt } from "viem";
import { settlerAbi, touchstoneHookAbi } from "../../abi/index.ts";
import type { SwapContext } from "./swap.ts";

export interface SettlementWindow {
  t0: bigint;
  latest: bigint;
  expiresAt: bigint;
}

/** The immutable event contains the full record, including closed-market mode and calendar inputs. */
export async function readRecordWindow(ctx: SwapContext, poolId: Hex, recordId: bigint, block: bigint): Promise<SettlementWindow> {
  const events = await ctx.client.getContractEvents({
    address: ctx.hook, abi: touchstoneHookAbi, eventName: "DepositTaken",
    args: { id: poolId, recordId }, fromBlock: block, toBlock: block,
  });
  const record = events.find((e) => e.args.record?.poolId.toLowerCase() === poolId.toLowerCase()
    && e.args.record.id === recordId)?.args.record;
  if (!record) throw new Error("The deposit record is not available in its confirmed block.");
  const [t0, latest, expiresAt] = await ctx.client.readContract({
    address: ctx.settler, abi: settlerAbi, functionName: "settleTime", args: [record],
  });
  return { t0, latest, expiresAt };
}

/** A finalized payout allocates a refund even when delivery failed and the ledger must be claimed. */
export async function readRefundDelivery(ctx: SwapContext, poolId: Hex, recordId: bigint, hash: Hex): Promise<"delivered" | "deferred"> {
  const receipt = await ctx.client.getTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error("The finalization transaction did not succeed.");
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== ctx.hook.toLowerCase()) continue;
    try {
      const event = decodeEventLog({ abi: touchstoneHookAbi, data: log.data, topics: log.topics });
      if (event.eventName === "RefundDeferred" && event.args.id.toLowerCase() === poolId.toLowerCase()
        && event.args.recordId === recordId) return "deferred";
    } catch { /* Other hook events do not describe refund delivery. */ }
  }
  return "delivered";
}

/** Only a matching execution log can establish the reasons for this deposit. */
export function confirmedReasons(hook: Hex, receipt: TransactionReceipt, poolId: Hex, id: bigint): number | null {
  for (let i = 1; i < receipt.logs.length; i++) {
    const deposit = receipt.logs[i - 1];
    const reasons = receipt.logs[i];
    if ([deposit, reasons].some((log) => log.address.toLowerCase() !== hook.toLowerCase())) continue;
    try {
      const e = decodeEventLog({ abi: touchstoneHookAbi, data: deposit.data, topics: deposit.topics });
      if (e.eventName !== "DepositTaken" || e.args.id.toLowerCase() !== poolId.toLowerCase() || e.args.recordId !== id) continue;
      const detail = decodeEventLog({ abi: touchstoneHookAbi, data: reasons.data, topics: reasons.topics });
      if (detail.eventName === "DepositReasons") return detail.args.triggers;
    } catch { /* Other logs cannot establish the reason for this deposit. */ }
  }
  return null;
}
