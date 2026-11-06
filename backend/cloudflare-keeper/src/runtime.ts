import { createPublicClient, createWalletClient, custom, defineChain, http, type EIP1193RequestFn, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { Keeper } from "../../keeper/src/keeper.ts";
import { Hermes } from "../../keeper/src/hermes.ts";
import { checkWiring } from "../../keeper/src/wiring.ts";
import type { KeeperState } from "../../keeper/src/state.ts";
import { configuration, safeErrorDetail, type Env } from "./config.ts";
import { TransactionJournal, type JournalStore, type Rpc } from "./journal.ts";

export async function createRuntime(env: Env, store: JournalStore, saved?: KeeperState) {
  const { keeper: e, cf } = configuration(env);
  const account = privateKeyToAccount(cf.KEEPER_PRIVATE_KEY as Hex);
  if (account.address.toLowerCase() !== cf.KEEPER_EXPECTED_ADDRESS.toLowerCase()) throw new Error("signer_mismatch");
  const chain = defineChain({ id: e.KEEPER_CHAIN_ID, name: "touchstone-keeper-chain",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [e.KEEPER_RPC_URL] } }, fees: { baseFeeMultiplier: 2 },
  });
  const underlying = http(e.KEEPER_RPC_URL, { timeout: 15000, retryCount: 0 })({ chain });
  const rpc: Rpc = args => underlying.request(args as never);
  const journal = new TransactionJournal(store, rpc);
  const transport = custom({ request: journal.request.bind(journal) as EIP1193RequestFn }, { retryCount: 0 });
  const client = createPublicClient({ chain, transport, pollingInterval: 1000, cacheTime: 0 });
  const wallet = createWalletClient({ account, chain, transport });
  const addresses = { hook: e.TOUCHSTONE_HOOK as Hex, settler: e.TOUCHSTONE_SETTLER as Hex,
    factory: e.TOUCHSTONE_FACTORY as Hex, ledger: e.TOUCHSTONE_LEDGER as Hex,
    ...(e.TOUCHSTONE_LICENCE ? { licence: e.TOUCHSTONE_LICENCE as Hex } : {}) };
  const problems = await checkWiring(client, e.KEEPER_CHAIN_ID, addresses);
  if (problems.length) throw new Error("deployment_wiring_invalid");
  const hermes = new Hermes({ url: e.HERMES_URL, apiKey: e.HERMES_API_KEY,
    apiKeyHeader: e.HERMES_API_KEY_HEADER, timeoutMs: e.HERMES_TIMEOUT_MS });
  const events: { level: string; msg: string; fields: Record<string, unknown> }[] = [];
  const keeper = new Keeper(client, wallet, hermes, addresses, {
    startBlock: e.KEEPER_START_BLOCK, minMarginBps: e.KEEPER_MIN_MARGIN_BPS,
    settleAtLoss: e.KEEPER_SETTLE_AT_LOSS, logBlockRange: BigInt(e.KEEPER_LOG_BLOCK_RANGE),
    dripsPerPeriod: e.KEEPER_DRIPS_PER_PERIOD, nativePriceId: e.KEEPER_NATIVE_PRICE_ID as Hex,
    pushRecipients: e.KEEPER_PUSH_RECIPIENTS as Hex[],
    ...(e.KEEPER_ACCRUE_INTERVAL_S ? { accrueIntervalS: e.KEEPER_ACCRUE_INTERVAL_S } : {}),
  }, saved ?? { nextBlock: e.KEEPER_START_BLOCK, open: [] }, (level, msg, fields) => {
    // Keep numeric/event outcomes, omit arbitrary errors (may embed RPC URLs).
    const { error: _error, reason: _reason, ...safe } = fields ?? {};
    const detail = typeof _error === "string" ? _error : typeof _reason === "string" ? _reason : "";
    const hermesStatus = /Hermes returned (\d{3})/.exec(detail)?.[1];
    if (hermesStatus) safe.errorCode = `hermes_http_${hermesStatus}`;
    else if (detail) safe.errorCode = /Illegal invocation|incorrect.*this/i.test(detail) ? "fetch_receiver_invalid"
      : /timeout|abort/i.test(detail) ? "request_timeout" : /revert/i.test(detail) ? "contract_reverted" : "request_failed";
    if (detail) safe.errorDetail = safeErrorDetail(detail, env);
    events.push({ level, msg, fields: safe });
    if (events.length > 10) events.shift();
    console[level](JSON.stringify({ service: "cloudflare-keeper", msg, ...safe }, (_, v: unknown) => typeof v === "bigint" ? v.toString() : v));
  });
  return { keeper, journal, account: account.address, client, cf, events, blockRange: BigInt(e.KEEPER_LOG_BLOCK_RANGE) };
}
