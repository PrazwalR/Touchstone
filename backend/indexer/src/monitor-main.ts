import { existsSync, readFileSync } from "node:fs";
import { createPublicClient, defineChain, http, type Address, type Hex } from "viem";
import { licenceAuctionAbi, loadEnv, logger, touchstoneFactoryAbi } from "@touchstone/shared";
import { keeperMetricsSchema } from "../../keeper/src/metrics.ts";
import { Alerter, discordSink, evaluate, monitorEnvSchema, MonitorReader, type Observation } from "./monitor.ts";

const log = logger("monitor");
const cfg = loadEnv(monitorEnvSchema);
const chain = defineChain({
  id: cfg.MONITOR_CHAIN_ID,
  name: `chain-${cfg.MONITOR_CHAIN_ID}`,
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [cfg.MONITOR_RPC_URL] } },
});
const client = createPublicClient({ chain, transport: http(cfg.MONITOR_RPC_URL, { timeout: 15_000 }) });
const reader = new MonitorReader(cfg.MONITOR_DATABASE_PATH, cfg.MONITOR_INDEXER_CHAIN);
const sink = discordSink(cfg.MONITOR_DISCORD_WEBHOOK_URL, fetch, `Touchstone ${cfg.MONITOR_INDEXER_CHAIN}`);
const alerter = new Alerter(sink, cfg.MONITOR_COOLDOWN_S);
const thresholds = {
  lagSlackS: cfg.MONITOR_LAG_SLACK_S,
  hermesErrorBps: cfg.MONITOR_HERMES_ERROR_BPS,
  hermesMinRequests: cfg.MONITOR_HERMES_MIN_REQUESTS,
  leaseWarnS: cfg.MONITOR_LEASE_WARN_S,
  keeperStaleS: cfg.MONITOR_KEEPER_STALE_S,
  minKeeperBalanceWei: cfg.MONITOR_MIN_KEEPER_BALANCE_WEI,
};
/** PoolFlags.LICENCE in contracts/src/types/PoolConfig.sol. */
const FLAG_LICENCE = 2;
const configs = new Map<string, { settleDelay: number; licensed: boolean }>();

async function poolConfig(poolId: string): Promise<{ settleDelay: number; licensed: boolean }> {
  const cached = configs.get(poolId);
  if (cached) return cached;
  const c = await client.readContract({ address: cfg.TOUCHSTONE_FACTORY as Address, abi: touchstoneFactoryAbi, functionName: "poolConfig", args: [poolId as Hex] });
  const v = { settleDelay: c.settleDelay, licensed: (c.flags & FLAG_LICENCE) !== 0 };
  configs.set(poolId, v);
  return v;
}

async function observe(): Promise<Observation> {
  const block = await client.getBlock({ blockTag: "latest" });
  const chainNow = Number(block.timestamp);
  const pools = reader.pools();
  const lag: Observation["lag"] = [];
  const leases: Observation["leases"] = [];
  for (const poolId of pools) {
    const pc = await poolConfig(poolId);
    lag.push({ poolId, settleDelay: pc.settleDelay, ...reader.p95Lag(poolId, cfg.MONITOR_LAG_SAMPLE) });
    if (pc.licensed && cfg.TOUCHSTONE_LICENCE !== undefined) {
      const auction = cfg.TOUCHSTONE_LICENCE as Address;
      const [[top, next], terms] = await Promise.all([
        client.readContract({ address: auction, abi: licenceAuctionAbi, functionName: "leases", args: [poolId as Hex], blockNumber: block.number }),
        client.readContract({ address: auction, abi: licenceAuctionAbi, functionName: "terms", args: [poolId as Hex], blockNumber: block.number }),
      ]);
      const live = top.rent > 0n && BigInt(top.owner) !== 0n;
      leases.push({
        poolId,
        lapsesAt: live ? Number(BigInt(top.since) + top.deposit / top.rent) : null,
        activatesAt: BigInt(next.owner) !== 0n ? next.since + terms[1] : null,
      });
    }
  }
  let keeper: Observation["keeper"] = null;
  if (existsSync(cfg.MONITOR_KEEPER_METRICS_PATH)) {
    const m = keeperMetricsSchema.parse(JSON.parse(readFileSync(cfg.MONITOR_KEEPER_METRICS_PATH, "utf8")));
    if (m.chainId !== cfg.MONITOR_CHAIN_ID) throw new Error("keeper metrics are for another chain");
    const balanceWei = await client.getBalance({ address: m.account as Address });
    keeper = { updatedAt: m.updatedAt, balanceWei, spent24hWei: BigInt(m.spent24hWei), requests: m.hermes.requests, errors: m.hermes.errors, windowSeconds: m.hermes.windowSeconds };
  }
  return { wallNow: Math.floor(Date.now() / 1000), chainNow, lag, ...reader.newEvents(), keeper, leases };
}

async function loop(): Promise<void> {
  try {
    const sent = await alerter.report(evaluate(await observe(), thresholds), Math.floor(Date.now() / 1000));
    if (sent) log.info("alerts sent", { lines: sent });
  } catch (err) {
    log.error("monitor cycle failed", { error: err instanceof Error ? err.message : String(err) });
    await alerter
      .report([{ key: "monitor:error", once: false, text: "The monitor could not read the chain, the indexer database or the keeper metrics; alerts are blind until it recovers." }], Math.floor(Date.now() / 1000))
      .catch(() => log.error("Discord webhook unreachable"));
  }
  setTimeout(() => void loop(), cfg.MONITOR_INTERVAL_MS);
}

if ((await client.getChainId()) !== cfg.MONITOR_CHAIN_ID) throw new Error("RPC serves a different chain");
await sink([`Monitor started for chain ${cfg.MONITOR_CHAIN_ID}; alerts follow spec 15.6.`]);
log.info("monitor started", { chainId: cfg.MONITOR_CHAIN_ID, intervalMs: cfg.MONITOR_INTERVAL_MS });
void loop();
for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => { reader.close(); process.exit(0); });
