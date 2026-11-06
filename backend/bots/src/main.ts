import { readFileSync, statSync } from "node:fs";
import { setTimeout as pause } from "node:timers/promises";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  encodeAbiParameters,
  erc20Abi,
  http,
  keccak256,
  parseAbi,
  zeroAddress,
  type Address,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { guardedRouterAbi, licenceAuctionAbi, loadEnv, logger, touchstoneHookAbi } from "@touchstone/shared";
import { loadKeystore } from "../../keeper/src/keystore.ts";
import { Hermes, toFloat } from "../../keeper/src/hermes.ts";
import { botSchema, deploymentSchema } from "./config.ts";
import { arbitrageDirection, isDepositRefusal, planBid, seeded, spot, sampleAmount } from "./strategy.ts";

const log = logger("demo-bot");
const cfg = loadEnv(botSchema);
const d = deploymentSchema.parse(
  JSON.parse(readFileSync(cfg.BOT_DEPLOYMENT_FILE, "utf8")),
);
if (d.chainId !== cfg.BOT_CHAIN_ID)
  throw new Error("deployment chain differs from bot chain");
const pool = d.pools[0];
if (!pool) throw new Error("one configured pool required");
const key = {
  currency0: pool.currency0 as Address,
  currency1: pool.currency1 as Address,
  fee: pool.fee,
  tickSpacing: pool.tickSpacing,
  hooks: pool.hooks as Address,
};
const currencies = new Set([
  key.currency0.toLowerCase(),
  key.currency1.toLowerCase(),
]);
if (
  currencies.size !== 2 ||
  !currencies.has(d.tokens.quote.address.toLowerCase()) ||
  !currencies.has(d.tokens.risky.address.toLowerCase())
)
  throw new Error("pool currencies differ from deployment tokens");
const poolId = keccak256(
  encodeAbiParameters(
    [
      { type: "address" },
      { type: "address" },
      { type: "uint24" },
      { type: "int24" },
      { type: "address" },
    ],
    [key.currency0, key.currency1, key.fee, key.tickSpacing, key.hooks],
  ),
);
if (poolId.toLowerCase() !== pool.poolId.toLowerCase())
  throw new Error("pool ID differs from its key");
const chain = defineChain({
  id: cfg.BOT_CHAIN_ID,
  name: "Touchstone testnet demonstration",
  testnet: true,
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [cfg.BOT_RPC_URL] } },
});
const client = createPublicClient({ chain, transport: http(cfg.BOT_RPC_URL) });
const rng = seeded(cfg.BOT_SEED);
const hermes = new Hermes({
  url: cfg.HERMES_URL.replace(/\/$/, ""),
  apiKey: cfg.HERMES_API_KEY,
  apiKeyHeader: cfg.HERMES_API_KEY_HEADER,
  timeoutMs: cfg.HERMES_TIMEOUT_MS,
});
const account = cfg.BOT_SUBMIT
  ? (() => {
      if ((statSync(cfg.BOT_PASSWORD_FILE).mode & 0o777) !== 0o600)
        throw new Error("password file must have mode 600");
      const signer = privateKeyToAccount(
        loadKeystore(cfg.BOT_KEYSTORE_PATH, cfg.BOT_PASSWORD_FILE),
      );
      if (signer.address.toLowerCase() !== cfg.BOT_ACCOUNT.toLowerCase())
        throw new Error("keystore address differs from BOT_ACCOUNT");
      return signer;
    })()
  : (cfg.BOT_ACCOUNT as Address);
const wallet =
  typeof account === "string"
    ? null
    : createWalletClient({ chain, transport: http(cfg.BOT_RPC_URL), account });
const licensed = cfg.BOT_MODE === "holder" || cfg.BOT_MODE === "bidder";
const auction: Address | null = licensed
  ? (() => {
      const a = d.contracts.licenceAuction;
      if (!a) throw new Error("holder and bidder modes need a deployment with a licence auction");
      return a as Address;
    })()
  : null;
const quoteToken = d.tokens.quote.address as Address;

/** Gas-bounded submission of a simulated call; the simulation is the only source of calldata. */
async function submit(request: Parameters<typeof client.estimateContractGas>[0], what: string): Promise<void> {
  if (wallet === null) return;
  const gas = await client.estimateContractGas(request);
  const gasPrice = await client.getGasPrice();
  if (gas > cfg.BOT_MAX_GAS || gasPrice > cfg.BOT_MAX_GAS_PRICE_WEI)
    throw new Error("transaction exceeds configured gas budget");
  const tx = await wallet.writeContract({ ...request, gas: cfg.BOT_MAX_GAS, gasPrice, type: "legacy" } as Parameters<typeof wallet.writeContract>[0]);
  const receipt = await client.waitForTransactionReceipt({ hash: tx });
  if (receipt.status !== "success") throw new Error(`testnet ${what} reverted`);
  log.info(`${what} confirmed`, { label: "testnet demonstration", tx, block: receipt.blockNumber, gasUsed: receipt.gasUsed });
}

/** One bidder round: claim displaced deposits, then place the smallest valid bid within the configured limits. */
async function bidRound(i: number): Promise<void> {
  const a = auction!;
  const id = pool!.poolId as `0x${string}`;
  const [[top, next], minNextRent, terms, refund] = await Promise.all([
    client.readContract({ address: a, abi: licenceAuctionAbi, functionName: "leases", args: [id] }),
    client.readContract({ address: a, abi: licenceAuctionAbi, functionName: "minNextRent", args: [id] }),
    client.readContract({ address: a, abi: licenceAuctionAbi, functionName: "terms", args: [id] }),
    client.readContract({ address: a, abi: licenceAuctionAbi, functionName: "refunds", args: [cfg.BOT_ACCOUNT as Address, quoteToken] }),
  ]);
  if (terms[0].toLowerCase() !== quoteToken.toLowerCase()) throw new Error("auction quote differs from deployment quote");
  if (refund > 0n) {
    const sim = await client.simulateContract({ account, address: a, abi: licenceAuctionAbi, functionName: "claimRefund", args: [quoteToken, cfg.BOT_ACCOUNT as Address] });
    log.info("refund claim simulated", { label: "testnet demonstration", iteration: i, refund, submitted: cfg.BOT_SUBMIT });
    await submit(sim.request, "refund claim");
  }
  const plan = planBid(
    { minNextRent, k: terms[1], holderOwner: top.owner, pendingOwner: next.owner },
    { self: cfg.BOT_ACCOUNT, maxRent: cfg.BOT_LEASE_MAX_RENT!, leaseSeconds: cfg.BOT_LEASE_SECONDS!, maxDeposit: cfg.BOT_LEASE_MAX_DEPOSIT! },
  );
  if (!plan.bid) {
    log.info("no bid", { label: "testnet demonstration", iteration: i, reason: plan.reason, minNextRent });
    return;
  }
  const allowance = await client.readContract({ address: quoteToken, abi: erc20Abi, functionName: "allowance", args: [cfg.BOT_ACCOUNT as Address, a] });
  if (allowance < plan.deposit)
    throw new Error("insufficient auction allowance; approve only the intended bounded testnet deposit separately");
  const sim = await client.simulateContract({ account, address: a, abi: licenceAuctionAbi, functionName: "bid", args: [id, cfg.BOT_ACCOUNT as Address, plan.rent, plan.deposit] });
  log.info("bid simulated", { label: "testnet demonstration", iteration: i, rent: plan.rent, deposit: plan.deposit, submitted: cfg.BOT_SUBMIT });
  await submit(sim.request, "bid");
}

const slotAbi = parseAbi([
  "function getSlot0(bytes32 id) view returns (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee)",
]);
const viewAbi = parseAbi([
  "function HOOK() view returns (address)",
  "function POOL_MANAGER() view returns (address)",
]);

async function run(): Promise<void> {
  if ((await client.getChainId()) !== cfg.BOT_CHAIN_ID)
    throw new Error("RPC chain differs from configured testnet");
  const [hook, manager, code] = await Promise.all([
    client.readContract({
      address: d.contracts.guardedRouter as Address,
      abi: viewAbi,
      functionName: "HOOK",
    }),
    client.readContract({
      address: d.contracts.guardedRouter as Address,
      abi: viewAbi,
      functionName: "POOL_MANAGER",
    }),
    client.getCode({ address: d.contracts.hook as Address }),
  ]);
  if (
    !code ||
    code === "0x" ||
    hook.toLowerCase() !== key.hooks.toLowerCase() ||
    hook.toLowerCase() !== d.contracts.hook.toLowerCase() ||
    manager.toLowerCase() !== d.uniswap.poolManager.toLowerCase()
  )
    throw new Error("deployment wiring differs from live contracts");
  if (auction !== null) {
    const [auctionHook, hookLicence] = await Promise.all([
      client.readContract({ address: auction, abi: licenceAuctionAbi, functionName: "HOOK" }),
      client.readContract({ address: d.contracts.hook as Address, abi: touchstoneHookAbi, functionName: "LICENCE" }),
    ]);
    if (auctionHook.toLowerCase() !== d.contracts.hook.toLowerCase() || hookLicence.toLowerCase() !== auction.toLowerCase())
      throw new Error("licence auction wiring differs from live contracts");
  }
  for (let i = 0; i < cfg.BOT_ITERATIONS; i++) {
    if (i) await pause(cfg.BOT_INTERVAL_MS);
    if (cfg.BOT_MODE === "bidder") {
      await bidRound(i);
      continue;
    }
    if (cfg.BOT_MODE === "holder") {
      // The exemption follows the lease's swapper, which GuardedRouter reports as this account.
      const [swapper, live] = await client.readContract({ address: auction!, abi: licenceAuctionAbi, functionName: "holderOf", args: [pool!.poolId as `0x${string}`] });
      if (!live || swapper.toLowerCase() !== cfg.BOT_ACCOUNT.toLowerCase()) {
        log.info("not the live licence holder", { label: "testnet demonstration", iteration: i, live });
        continue;
      }
    }
    let zeroForOne = cfg.BOT_ZERO_FOR_ONE;
    if (cfg.BOT_MODE === "outsider" || cfg.BOT_MODE === "holder") {
      const [slot, base, quote, block] = await Promise.all([
        client.readContract({
          address: d.uniswap.stateView as Address,
          abi: slotAbi,
          functionName: "getSlot0",
          args: [pool!.poolId as `0x${string}`],
        }),
        hermes.latest(d.oracles.pythEthUsdId as `0x${string}`),
        hermes.latest(d.oracles.pythUsdcUsdId as `0x${string}`),
        client.getBlock(),
      ]);
      const now = Number(block.timestamp);
      for (const price of [base, quote])
        if (
          price.publishTime > now ||
          now - price.publishTime > cfg.BOT_PRICE_MAX_AGE_SECONDS
        )
          throw new Error("stale or future reference");
      const confBps = (price: typeof base) =>
        (price.conf * 10_000n + price.price - 1n) / price.price;
      if (confBps(base) + confBps(quote) > BigInt(cfg.BOT_MAX_CONF_BPS))
        throw new Error("reference confidence exceeds bot limit");
      const direction = arbitrageDirection(
        spot(
          slot[0],
          key.currency0.toLowerCase() === d.tokens.quote.address.toLowerCase(),
          d.tokens.quote.decimals,
          d.tokens.risky.decimals,
        ),
        toFloat(base) / toFloat(quote),
        cfg.BOT_MIN_EDGE_BPS,
        key.currency0.toLowerCase() === d.tokens.quote.address.toLowerCase(),
      );
      if (direction === null) {
        log.info("no configured reference edge", {
          label: "testnet demonstration",
          seed: cfg.BOT_SEED,
          iteration: i,
        });
        continue;
      }
      // Amounts, limits and guard units are configured for one direction; never reinterpret them after a signal flips.
      if (direction !== zeroForOne) {
        log.info("reference edge is opposite configured direction", {
          label: "testnet demonstration",
          iteration: i,
        });
        continue;
      }
    }
    const amount = sampleAmount(rng, cfg.BOT_AMOUNT_MIN, cfg.BOT_AMOUNT_MAX);
    const input = zeroForOne ? key.currency0 : key.currency1;
    if (input !== zeroAddress) {
      const allowance = await client.readContract({
        address: input,
        abi: erc20Abi,
        functionName: "allowance",
        args: [
          cfg.BOT_ACCOUNT as Address,
          d.contracts.guardedRouter as Address,
        ],
      });
      if (allowance < amount)
        throw new Error(
          "insufficient allowance; approve only the intended bounded testnet amount separately",
        );
    }
    const block = await client.getBlock();
    const params = {
      zeroForOne,
      amountSpecified: -amount,
      sqrtPriceLimitX96: cfg.BOT_SQRT_PRICE_LIMIT_X96,
    };
    const guard = {
      // A holder trades only when exempt: any deposit means the exemption does not apply in this block.
      maxDeposit: cfg.BOT_MODE === "holder" ? 0n : cfg.BOT_MAX_DEPOSIT,
      minNetOut: cfg.BOT_MIN_NET_OUT,
      minGrossOut: cfg.BOT_MIN_GROSS_OUT,
      maxNetIn: amount,
    };
    const simulate = () => client.simulateContract({
      account,
      address: d.contracts.guardedRouter as Address,
      abi: guardedRouterAbi,
      functionName: "swapGuarded",
      args: [
        key,
        params,
        guard,
        cfg.BOT_ACCOUNT as Address,
        block.timestamp + BigInt(cfg.BOT_DEADLINE_SECONDS),
      ],
      value: input === zeroAddress ? amount : 0n,
    });
    let simulation: Awaited<ReturnType<typeof simulate>>;
    try {
      simulation = await simulate();
    } catch (err) {
      if (cfg.BOT_MODE !== "holder" || !isDepositRefusal(err)) throw err;
      log.info("not exempt in this block; skipped", { label: "testnet demonstration", iteration: i });
      continue;
    }
    log.info("swap simulated", {
      label: "testnet demonstration",
      seed: cfg.BOT_SEED,
      iteration: i,
      mode: cfg.BOT_MODE,
      amount,
      deposit: simulation.result[1],
      submitted: cfg.BOT_SUBMIT,
    });
    if (wallet !== null) {
      const gas = await client.estimateContractGas(simulation.request);
      const gasPrice = await client.getGasPrice();
      if (gas > cfg.BOT_MAX_GAS || gasPrice > cfg.BOT_MAX_GAS_PRICE_WEI)
        throw new Error("transaction exceeds configured gas budget");
      const tx = await wallet.writeContract({
        address: d.contracts.guardedRouter as Address,
        abi: guardedRouterAbi,
        functionName: "swapGuarded",
        args: [
          key,
          params,
          guard,
          cfg.BOT_ACCOUNT as Address,
          block.timestamp + BigInt(cfg.BOT_DEADLINE_SECONDS),
        ],
        value: input === zeroAddress ? amount : 0n,
        gas: cfg.BOT_MAX_GAS,
        gasPrice,
        type: "legacy",
      });
      const receipt = await client.waitForTransactionReceipt({ hash: tx });
      if (receipt.status !== "success")
        throw new Error("testnet swap reverted");
      log.info("swap confirmed", {
        label: "testnet demonstration",
        tx,
        block: receipt.blockNumber,
        gasUsed: receipt.gasUsed,
      });
    }
  }
}
void run().catch(() => {
  log.error(
    "bot stopped; check configuration, balances, allowance and reference availability",
  );
  process.exitCode = 1;
});
