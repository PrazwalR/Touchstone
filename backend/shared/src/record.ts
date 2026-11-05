import { decodeEventLog, type Hex, type Log } from "viem";
import { touchstoneHookAbi } from "../abi/TouchstoneHook.ts";

/** A flagged swap, exactly as the hook emits it in DepositTaken and as Settler.settle takes it. */
export interface TouchstoneRecord {
  poolId: Hex;
  id: bigint;
  timestamp: number;
  mode: number;
  licenceActive: boolean;
  byHolder: boolean;
  zeroForOne: boolean;
  depositIn0: boolean;
  sender: Hex;
  beneficiary: Hex;
  rebateTo: Hex;
  deposit: bigint;
  amount0: bigint;
  amount1: bigint;
  sqrtPriceBeforeX96: bigint;
  sqrtPriceAfterX96: bigint;
  liquidityBefore: bigint;
  swapFeePips: number;
}

/** Decodes a DepositTaken log; returns null for any other log. Logs are untrusted input. */
export function decodeDepositTaken(log: Pick<Log, "data" | "topics">): TouchstoneRecord | null {
  try {
    const decoded = decodeEventLog({ abi: touchstoneHookAbi, data: log.data, topics: log.topics, strict: true });
    if (decoded.eventName !== "DepositTaken") return null;
    const r = decoded.args.record;
    return {
      poolId: r.poolId,
      id: r.id,
      timestamp: r.timestamp,
      mode: r.mode,
      licenceActive: r.licenceActive,
      byHolder: r.byHolder,
      zeroForOne: r.zeroForOne,
      depositIn0: r.depositIn0,
      sender: r.sender,
      beneficiary: r.beneficiary,
      rebateTo: r.rebateTo,
      deposit: r.deposit,
      amount0: r.amount0,
      amount1: r.amount1,
      sqrtPriceBeforeX96: r.sqrtPriceBeforeX96,
      sqrtPriceAfterX96: r.sqrtPriceAfterX96,
      liquidityBefore: r.liquidityBefore,
      swapFeePips: r.swapFeePips,
    };
  } catch {
    return null;
  }
}
