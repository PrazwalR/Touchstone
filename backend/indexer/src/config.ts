import { z } from "zod";
import { address, httpUrl, loadEnv, positiveInt } from "@touchstone/shared";

export const indexerEnvSchema = z.object({
  INDEXER_CHAIN: z.string().regex(/^[a-z0-9-]+$/),
  INDEXER_RPC_URL: httpUrl,
  INDEXER_DATABASE_PATH: z.string().min(1),
  INDEXER_CONFIRMATIONS: positiveInt,
  INDEXER_START_BLOCK: z.coerce.bigint().nonnegative(),
  INDEXER_BLOCK_RANGE: positiveInt,
  INDEXER_POLL_INTERVAL_MS: positiveInt,
  TOUCHSTONE_HOOK: address,
  TOUCHSTONE_SETTLER: address,
  TOUCHSTONE_LEDGER: address,
  TOUCHSTONE_FACTORY: address,
  TOUCHSTONE_LICENCE: z.preprocess((v) => v === "" ? undefined : v, address.optional()),
  POOL_MANAGER: address,
});

export type IndexerEnv = z.infer<typeof indexerEnvSchema>;

export const loadIndexerEnv = (source: NodeJS.ProcessEnv = process.env): IndexerEnv => loadEnv(indexerEnvSchema, source);
