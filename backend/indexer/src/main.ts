import { createPublicClient, http } from "viem";
import { logger } from "@touchstone/shared";
import { loadIndexerEnv } from "./config.ts";
import { Indexer } from "./indexer.ts";
import { Store } from "./store.ts";

const log = logger("indexer");
const env = loadIndexerEnv();
const client = createPublicClient({ transport: http(env.INDEXER_RPC_URL) });
const indexer = new Indexer(
  client,
  new Store(env.INDEXER_DATABASE_PATH),
  {
    chain: env.INDEXER_CHAIN,
    ...(env.TOUCHSTONE_LICENCE === undefined ? {} : { licence: env.TOUCHSTONE_LICENCE as `0x${string}` }),
    hook: env.TOUCHSTONE_HOOK as `0x${string}`,
    settler: env.TOUCHSTONE_SETTLER as `0x${string}`,
    ledger: env.TOUCHSTONE_LEDGER as `0x${string}`,
    factory: env.TOUCHSTONE_FACTORY as `0x${string}`,
    poolManager: env.POOL_MANAGER as `0x${string}`,
    confirmations: BigInt(env.INDEXER_CONFIRMATIONS),
    startBlock: env.INDEXER_START_BLOCK,
    blockRange: BigInt(env.INDEXER_BLOCK_RANGE),
  },
  (level, msg, fields) => log[level](msg, fields),
);

async function loop(): Promise<void> {
  try {
    await indexer.tick();
  } catch (err) {
    log.error("tick failed", { error: err instanceof Error ? err.message : String(err) });
  }
  setTimeout(() => void loop(), env.INDEXER_POLL_INTERVAL_MS);
}

void loop();
