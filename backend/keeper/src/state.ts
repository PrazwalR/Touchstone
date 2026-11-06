import { readFileSync, renameSync, writeFileSync } from "node:fs";
import type { Hex } from "viem";
import { z } from "zod";
import type { TouchstoneRecord } from "@touchstone/shared";

/** What the keeper persists between restarts: where it stopped reading logs, and the records still open. */
export interface KeeperState {
  nextBlock: bigint;
  lastBlockHash?: Hex;
  poolIds?: Hex[];
  open: TouchstoneRecord[];
}

const hex32 = z.string().regex(/^0x[0-9a-fA-F]{64}$/).transform((v): Hex => v as Hex);
const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/).transform((v): Hex => v as Hex);
const uint = (bits: number) => z.bigint().min(0n).max((1n << BigInt(bits)) - 1n);
const int128 = z.bigint().min(-(1n << 127n)).max((1n << 127n) - 1n);
const recordSchema = z.strictObject({
  poolId: hex32, id: uint(64), timestamp: z.number().int().min(0).max(2 ** 40 - 1),
  mode: z.number().int().min(0).max(255), licenceActive: z.boolean(), byHolder: z.boolean(),
  zeroForOne: z.boolean(), depositIn0: z.boolean(), sender: address, beneficiary: address, rebateTo: address,
  deposit: uint(128), amount0: int128, amount1: int128,
  sqrtPriceBeforeX96: uint(160), sqrtPriceAfterX96: uint(160), liquidityBefore: uint(128),
  swapFeePips: z.number().int().min(0).max(2 ** 24 - 1),
});
const stateSchema = z.strictObject({
  nextBlock: z.bigint().nonnegative(), lastBlockHash: hex32.optional(), poolIds: z.array(hex32).optional(), open: z.array(recordSchema),
});

const replacer = (_k: string, v: unknown): unknown => (typeof v === "bigint" ? { $bigint: v.toString() } : v);
const reviver = (_k: string, v: unknown): unknown =>
  v !== null && typeof v === "object" && "$bigint" in v ? BigInt(String((v as { $bigint: string }).$bigint)) : v;

export function loadState(path: string, startBlock: bigint): KeeperState {
  try {
    const s = stateSchema.parse(JSON.parse(readFileSync(path, "utf8"), reviver));
    return { nextBlock: s.nextBlock, open: s.open, ...(s.poolIds === undefined ? {} : { poolIds: s.poolIds }), ...(s.lastBlockHash === undefined ? {} : { lastBlockHash: s.lastBlockHash }) };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { nextBlock: startBlock, open: [] };
    throw err;
  }
}

/** Atomic write: a crash mid-write leaves the previous state, never a truncated file. */
export function saveState(path: string, s: KeeperState): void {
  writeFileSync(`${path}.tmp`, JSON.stringify(s, replacer));
  renameSync(`${path}.tmp`, path);
}

export const recordKey = (r: { poolId: Hex; id: bigint }): string => `${r.poolId.toLowerCase()}:${r.id.toString()}`;
