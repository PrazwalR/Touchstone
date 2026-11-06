import { parseAbi, zeroAddress } from "viem";
import { touchstoneHookAbi } from "../../abi/index.ts";
import type { Snapshot } from "../chain/reads.ts";
import type { SwapContext } from "./swap.ts";

const feedAbi = parseAbi([
  "function latestRoundData() view returns (uint80,int256,uint256,uint256,uint80)",
  "function decimals() view returns (uint8)",
]);

/** The same positive-answer, timestamp and max-age checks used by ReferenceLib. */
export function referencePriceE6(answer: bigint, decimals: number, updatedAt: bigint, now: bigint, maxAge: number): bigint {
  if (answer <= 0n || updatedAt === 0n || updatedAt > now || now - updatedAt > BigInt(maxAge))
    throw new Error("Chainlink reference is stale, future-dated or invalid; drift comparison is unavailable.");
  const price = decimals >= 6 ? answer / 10n ** BigInt(decimals - 6) : answer * 10n ** BigInt(6 - decimals);
  if (price <= 0n) throw new Error("Chainlink reference cannot be represented at the display precision.");
  return price;
}

export async function readReference(ctx: SwapContext, snapshot: Snapshot) {
  const cfg = snapshot.config;
  if (cfg.referenceFeed === zeroAddress) throw new Error("The pool has no Chainlink reference configured.");
  const at = { blockNumber: snapshot.blockNumber };
  const [round, decimals, sequencerFeed, grace] = await Promise.all([
    ctx.client.readContract({ ...at, address: cfg.referenceFeed, abi: feedAbi, functionName: "latestRoundData" }),
    ctx.client.readContract({ ...at, address: cfg.referenceFeed, abi: feedAbi, functionName: "decimals" }),
    ctx.client.readContract({ ...at, address: ctx.hook, abi: touchstoneHookAbi, functionName: "SEQUENCER_FEED" }),
    ctx.client.readContract({ ...at, address: ctx.hook, abi: touchstoneHookAbi, functionName: "SEQUENCER_GRACE" }),
  ]);
  if (sequencerFeed !== zeroAddress) {
    const uptime = await ctx.client.readContract({ ...at, address: sequencerFeed, abi: feedAbi, functionName: "latestRoundData" });
    if (uptime[1] !== 0n || uptime[2] === 0n || uptime[2] > snapshot.blockTime || snapshot.blockTime - uptime[2] < BigInt(grace))
      throw new Error("The sequencer is down or within its recovery grace period; drift comparison is unavailable.");
  }
  return {
    priceE6: referencePriceE6(round[1], decimals, round[3], snapshot.blockTime, cfg.referenceMaxAge),
    updatedAt: Number(round[3]),
    blockNumber: snapshot.blockNumber,
  };
}
