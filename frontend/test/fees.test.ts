import { expect, it, vi } from "vitest";
import type { PublicClient } from "viem";
import { submissionFees } from "../src/swap/fees.ts";

it("buffers Arbitrum's base fee while preserving the estimated tip", async () => {
  const client = {
    chain: { id: 421614 },
    getBlock: vi.fn().mockResolvedValue({ baseFeePerGas: 20_070_000n }),
    estimateFeesPerGas: vi.fn().mockResolvedValue({ maxFeePerGas: 20_000_000n, maxPriorityFeePerGas: 100n }),
  } as unknown as PublicClient;
  expect(await submissionFees(client)).toEqual({ maxFeePerGas: 40_140_100n, maxPriorityFeePerGas: 100n });
});
it("preserves a higher RPC fee estimate", async () => {
  const client = {
    chain: { id: 421614 },
    getBlock: vi.fn().mockResolvedValue({ baseFeePerGas: 20_000_000n }),
    estimateFeesPerGas: vi.fn().mockResolvedValue({ maxFeePerGas: 80_000_000n, maxPriorityFeePerGas: 0n }),
  } as unknown as PublicClient;
  expect((await submissionFees(client)).maxFeePerGas).toBe(80_000_000n);
});
it("keeps other chains on their existing wallet fee path", async () => {
  expect(await submissionFees({ chain: { id: 31337 } } as PublicClient)).toEqual({});
});
