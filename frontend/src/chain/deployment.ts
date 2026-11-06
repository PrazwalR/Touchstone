// The deployment the page reads, validated once at load. A malformed or edited file fails here, not mid-render.
import { getAddress, type Address, type Hex } from "viem";
import { z } from "zod";
import { selectDeployment } from "./selectDeployment.ts";

const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/, "address").transform((a) => getAddress(a) as Address);
const bytes32 = z.string().regex(/^0x[0-9a-fA-F]{64}$/, "bytes32").transform((h) => h as Hex);
const https = z.url().refine((u) => u.startsWith("https://"), "https only");

const token = z.strictObject({ symbol: z.string().min(1), address, decimals: z.number().int().min(0).max(36) });

export const DeploymentSchema = z.strictObject({
  chain: z.string().min(1),
  chainId: z.number().int().positive(),
  name: z.string().min(1),
  explorer: https,
  publicRpc: https,
  deployBlock: z.number().int().positive(),
  contracts: z.strictObject({
    hook: address,
    settler: address,
    ledger: address,
    factory: address,
    guardedRouter: address,
    nyseCalendar: address.nullable(),
    licenceAuction: address.nullable(),
    lens: address.nullable(),
  }),
  uniswap: z.strictObject({ poolManager: address, stateView: address, quoter: address, poolSwapTest: address }),
  oracles: z.strictObject({ pyth: address, chainlinkEthUsd: address, pythEthUsdId: bytes32, pythUsdcUsdId: bytes32 }),
  tokens: z.strictObject({ risky: token, quote: token }),
  pools: z
    .array(
      z.strictObject({
        label: z.string().min(1),
        poolId: bytes32,
        currency0: address,
        currency1: address,
        fee: z.number().int().min(0).max(1_000_000),
        tickSpacing: z.number().int().min(1).max(32_767),
        hooks: address,
        initialSqrtPriceX96: z.string().regex(/^\d+$/),
        initialLiquidity: z.number().int().nonnegative(),
      }),
    )
    .min(1),
});

export type Deployment = z.infer<typeof DeploymentSchema>;
export type PoolEntry = Deployment["pools"][number];

export function parseDeployment(raw: unknown): Deployment {
  const d = DeploymentSchema.parse(raw);
  for (const p of d.pools) {
    if (p.hooks !== d.contracts.hook) throw new Error(`pool ${p.label} names a different hook`);
  }
  return d;
}

export const deployment: Deployment = parseDeployment(selectDeployment(import.meta.env.VITE_CHAIN));
export const pool: PoolEntry = deployment.pools[0];

/** True when the pool's currency0 is the quote token; the demo pool has native ETH as currency0. */
export const quoteIs0 = pool.currency0 === deployment.tokens.quote.address;

export function explorerAddress(a: string): string {
  return `${deployment.explorer}/address/${a}`;
}
export function explorerTx(h: string): string {
  return `${deployment.explorer}/tx/${h}`;
}
