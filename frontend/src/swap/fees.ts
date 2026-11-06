import type { PublicClient } from "viem";

/** Refresh at submission, with headroom for base-fee changes while the wallet is open. */
export async function submissionFees(client: PublicClient) {
  if (client.chain?.id !== 421614) return {};
  const [block, estimated] = await Promise.all([
    client.getBlock({ blockTag: "latest" }),
    client.estimateFeesPerGas(),
  ]);
  if (block.baseFeePerGas === null) throw new Error("The RPC did not return an EIP-1559 base fee. Refresh before signing.");
  const buffered = 2n * block.baseFeePerGas + estimated.maxPriorityFeePerGas;
  return {
    maxFeePerGas: estimated.maxFeePerGas > buffered ? estimated.maxFeePerGas : buffered,
    maxPriorityFeePerGas: estimated.maxPriorityFeePerGas,
  };
}
