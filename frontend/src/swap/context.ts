// The deployment's swap context: the addresses the swap module needs, and a public client for reads and
// simulations. Separate from reads.ts, whose bare client deliberately carries only read actions.
import { createPublicClient, http, type Hex, type PublicClient } from "viem";
import { RPC_URL } from "../config.ts";
import { chain, poolKey } from "../chain/reads.ts";
import { deployment, pool } from "../chain/deployment.ts";
import type { SwapContext } from "./swap.ts";

const client = createPublicClient({ chain, transport: http(RPC_URL, { retryCount: 2, timeout: 15_000 }) }) as PublicClient;

export const swapContext: SwapContext = {
  client,
  manager: deployment.uniswap.poolManager,
  hook: deployment.contracts.hook,
  settler: deployment.contracts.settler,
  router: deployment.contracts.guardedRouter,
  quoter: deployment.uniswap.quoter,
  key: poolKey,
  poolId: pool.poolId as Hex,
  risky: deployment.tokens.risky,
  quote: deployment.tokens.quote,
};
