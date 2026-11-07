import { createPublicClient, createWalletClient, defineChain, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { logger } from "@touchstone/shared";
import { loadKeeperEnv } from "./config.ts";
import { Hermes } from "./hermes.ts";
import { Keeper } from "./keeper.ts";
import { loadKeystore } from "./keystore.ts";
import { loadState, saveState } from "./state.ts";
import { checkWiring } from "./wiring.ts";
import { writeMetrics } from "./metrics.ts";

const log = logger("keeper");
const env = loadKeeperEnv();
const chain = defineChain({
  id: env.KEEPER_CHAIN_ID,
  name: `chain-${env.KEEPER_CHAIN_ID}`,
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [env.KEEPER_RPC_URL] } },
});
const transport = http(env.KEEPER_RPC_URL);
const account = privateKeyToAccount(loadKeystore(env.KEEPER_KEYSTORE_PATH, env.KEEPER_KEYSTORE_PASSWORD_FILE));
const client = createPublicClient({ chain, transport });
const wallet = createWalletClient({ chain, transport, account });
const hermes = new Hermes({
  url: env.HERMES_URL,
  apiKey: env.HERMES_API_KEY,
  apiKeyHeader: env.HERMES_API_KEY_HEADER,
  timeoutMs: env.HERMES_TIMEOUT_MS,
});
const addresses = { hook: env.TOUCHSTONE_HOOK as `0x${string}`, settler: env.TOUCHSTONE_SETTLER as `0x${string}`, factory: env.TOUCHSTONE_FACTORY as `0x${string}`, ledger: env.TOUCHSTONE_LEDGER as `0x${string}`, ...(env.TOUCHSTONE_LICENCE === undefined ? {} : { licence: env.TOUCHSTONE_LICENCE as `0x${string}` }) };
const keeper = new Keeper(
  client,
  wallet,
  hermes,
  addresses,
  {
    startBlock: env.KEEPER_START_BLOCK,
    ...(env.KEEPER_ACCRUE_INTERVAL_S === undefined ? {} : { accrueIntervalS: env.KEEPER_ACCRUE_INTERVAL_S }),
    minMarginBps: env.KEEPER_MIN_MARGIN_BPS,
    settleAtLoss: env.KEEPER_SETTLE_AT_LOSS,
    ...(env.KEEPER_DECLINED_RETRY_S === undefined ? {} : { declinedRetryS: env.KEEPER_DECLINED_RETRY_S }),
    logBlockRange: BigInt(env.KEEPER_LOG_BLOCK_RANGE),
    dripsPerPeriod: env.KEEPER_DRIPS_PER_PERIOD,
    nativePriceId: env.KEEPER_NATIVE_PRICE_ID as `0x${string}`,
    pushRecipients: env.KEEPER_PUSH_RECIPIENTS as `0x${string}`[],
  },
  loadState(env.KEEPER_STATE_PATH, env.KEEPER_START_BLOCK),
  (level, msg, fields) => log[level](msg, fields),
);

const problems = await checkWiring(client, env.KEEPER_CHAIN_ID, addresses);
if (problems.length) {
  log.error("deployment wiring check failed; not starting", { problems });
  process.exit(1);
}
log.info("keeper started", { account: account.address, chainId: env.KEEPER_CHAIN_ID });

async function loop(): Promise<void> {
  try {
    const report = await keeper.tick();
    saveState(env.KEEPER_STATE_PATH, keeper.state());
    if (env.KEEPER_METRICS_PATH !== undefined && env.KEEPER_HERMES_WINDOW_S !== undefined) {
      writeMetrics(env.KEEPER_METRICS_PATH, {
        version: 1,
        updatedAt: Math.floor(Date.now() / 1000),
        chainId: env.KEEPER_CHAIN_ID,
        account: account.address,
        spent24hWei: keeper.spentSince(86_400).toString(),
        hermes: hermes.stats(env.KEEPER_HERMES_WINDOW_S),
        openRecords: keeper.openRecords().length,
      });
    }
    if (Object.values(report).some((v) => v > 0)) log.info("tick", { ...report });
  } catch (err) {
    log.error("tick failed", { error: err instanceof Error ? err.message : String(err) });
  }
  setTimeout(() => void loop(), env.KEEPER_POLL_INTERVAL_MS);
}

void loop();
