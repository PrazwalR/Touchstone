import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { createServer, type Server } from "node:http";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createPublicClient,
  createTestClient,
  createWalletClient,
  encodeAbiParameters,
  erc20Abi,
  http,
  parseAbiParameters,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { licenceAuctionAbi, rebateLedgerAbi, touchstoneHookAbi } from "@touchstone/shared";
import { Hermes } from "../src/hermes.ts";
import { Keeper } from "../src/keeper.ts";
import { checkWiring } from "../src/wiring.ts";

// Anvil's well-known development accounts (public test keys, funded only on a local anvil).
const DEPLOYER_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const KEEPER_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const PORT = 8_547;
const RPC = `http://127.0.0.1:${PORT}`;
const contractsDir = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "contracts");
const NATIVE_ID = `0x${"ee".repeat(32)}` as Hex;
const ACCRUE_INTERVAL_S = 60;

interface Stack {
  swapRouter: Address;
  hook: Address;
  settler: Address;
  factory: Address;
  ledger: Address;
  usdc: Address;
  weth: Address;
  quoteIs0: boolean;
  baseId: Hex;
  quoteId: Hex;
  poolId: Hex;
  licence: Address;
  licencePoolId: Hex;
  leaseK: number;
}

const hasTool = (bin: string): boolean => {
  try {
    execFileSync(bin, ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
};

/** A Hermes stand-in that serves MockPythUnique-encoded updates in Hermes' response shape. */
function hermesStub(prices: Map<Hex, bigint>, notYet: Set<number>): Server {
  const feed = parseAbiParameters(
    "(bytes32 id, (int64 price, uint64 conf, int32 expo, uint256 publishTime) price, (int64 price, uint64 conf, int32 expo, uint256 publishTime) emaPrice) feed, uint64 prev",
  );
  return createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://stub");
    const m = url.pathname.match(/^\/v2\/updates\/price\/(\d+|latest)$/);
    const id = url.searchParams.get("ids[]") as Hex | null;
    const price = id === null ? undefined : prices.get(id.toLowerCase() as Hex);
    if (m === null || id === null || price === undefined) return void res.writeHead(400).end();
    const t = m[1] === "latest" ? Math.floor(Date.now() / 1000) : Number(m[1]);
    if (notYet.has(t)) return void res.writeHead(404).end();
    const p = { price, conf: 0n, expo: -8, publishTime: BigInt(t) };
    const blob = encodeAbiParameters(feed, [{ id, price: p, emaPrice: p }, BigInt(t - 1)]);
    res.writeHead(200, { "content-type": "application/json" }).end(
      JSON.stringify({
        binary: { encoding: "hex", data: [blob.slice(2)] },
        parsed: [{ id: id.slice(2), price: { price: price.toString(), conf: "0", expo: -8, publish_time: t } }],
      }),
    );
  });
}

describe.skipIf(!hasTool("anvil") || !hasTool("forge"))("keeper end to end on anvil", () => {
  let anvil: ChildProcess;
  let hermesServer: Server;
  let stack: Stack;
  const prices = new Map<Hex, bigint>();
  const notYet = new Set<number>();
  const chain = { ...foundry, rpcUrls: { default: { http: [RPC] } } };
  const client = createPublicClient({ chain, transport: http(RPC) });
  const test = createTestClient({ chain, mode: "anvil", transport: http(RPC) });
  const trader = createWalletClient({ chain, transport: http(RPC), account: privateKeyToAccount(DEPLOYER_KEY) });
  const keeperWallet = createWalletClient({ chain, transport: http(RPC), account: privateKeyToAccount(KEEPER_KEY) });
  let keeper: Keeper;
  let swapAbi: import("viem").Abi;
  const erc20 = [{ type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "a", type: "address" }], outputs: [{ type: "uint256" }] }] as const;

  async function swapBuy(usd: bigint): Promise<void> {
    const zeroForOne = stack.quoteIs0;
    const key = {
      currency0: stack.quoteIs0 ? stack.usdc : stack.weth,
      currency1: stack.quoteIs0 ? stack.weth : stack.usdc,
      fee: 500,
      tickSpacing: 60,
      hooks: stack.hook,
    };
    const params = {
      zeroForOne,
      amountSpecified: -(usd * 1_000_000n),
      sqrtPriceLimitX96: zeroForOne ? 4295128740n : 1461446703485210103287273052203988822378723970341n,
    };
    const hash = await trader.writeContract({
      address: stack.swapRouter,
      abi: swapAbi,
      functionName: "swap",
      args: [key, params, { takeClaims: false, settleUsingBurn: false }, "0x"],
    });
    const receipt = await client.waitForTransactionReceipt({ hash });
    expect(receipt.status).toBe("success");
    expect(receipt.logs.some((l) => l.address.toLowerCase() === stack.hook.toLowerCase())).toBe(true);
  }

  async function advance(seconds: number): Promise<void> {
    await test.increaseTime({ seconds });
    await test.mine({ blocks: 1 });
  }

  beforeAll(async () => {
    mkdirSync(join(contractsDir, "test", "integration", "out"), { recursive: true });
    swapAbi = JSON.parse(readFileSync(join(contractsDir, "out", "PoolSwapTest.sol", "PoolSwapTest.json"), "utf8")).abi;
    anvil = spawn("anvil", ["--port", String(PORT), "--silent", "--disable-code-size-limit"], { stdio: "ignore" });
    for (let i = 0; i < 50; i++) {
      try {
        await client.getBlockNumber();
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 100));
      }
    }
    execFileSync(
      "forge",
      ["script", "test/integration/LocalStack.s.sol", "--rpc-url", RPC, "--broadcast", "--disable-code-size-limit", "--private-key", DEPLOYER_KEY],
      { cwd: contractsDir, stdio: "ignore", env: { ...process.env, STACK_OUT: `test/integration/out/stack-${PORT}.json` } },
    );
    stack = JSON.parse(readFileSync(join(contractsDir, "test", "integration", "out", `stack-${PORT}.json`), "utf8")) as Stack;
    prices.set(stack.baseId.toLowerCase() as Hex, 3_300n * 10n ** 8n);
    prices.set(stack.quoteId.toLowerCase() as Hex, 10n ** 8n);
    prices.set(NATIVE_ID, 3_300n * 10n ** 8n);
    hermesServer = hermesStub(prices, notYet);
    await new Promise<void>((r) => hermesServer.listen(0, r));
    const port = (hermesServer.address() as { port: number }).port;
    keeper = new Keeper(
      client,
      keeperWallet,
      new Hermes({ url: `http://127.0.0.1:${port}`, apiKey: "test", apiKeyHeader: "x-api-key", timeoutMs: 2_000 }),
      { hook: stack.hook, settler: stack.settler, factory: stack.factory, ledger: stack.ledger, licence: stack.licence },
      { startBlock: 0n, minMarginBps: 1_000, settleAtLoss: true, logBlockRange: 1_000n, dripsPerPeriod: 10, nativePriceId: NATIVE_ID, pushRecipients: [], accrueIntervalS: ACCRUE_INTERVAL_S },
      { nextBlock: 0n, open: [] },
      () => undefined,
    );
  }, 180_000);

  afterAll(() => {
    anvil?.kill();
    hermesServer?.close();
  });

  it("ingests a flagged swap, waits for t0, then settles against the first update and earns the tip", async () => {
    await swapBuy(500_000n);
    let report = await keeper.tick();
    expect(report.ingested).toBe(1);
    expect(report.settled).toBe(0);

    await advance(5);
    // An exact-input buy's unspecified currency is its output, the risky token, so the deposit and tip are WETH.
    const tipToken = stack.weth;
    const before = await client.readContract({ address: tipToken, abi: erc20, functionName: "balanceOf", args: [keeperWallet.account.address] });
    const owedBefore = await client.readContract({ address: stack.ledger, abi: rebateLedgerAbi, functionName: "owed", args: [keeperWallet.account.address, tipToken] });
    report = await keeper.tick();
    expect(report.settled).toBe(1);
    expect(keeper.openRecords()).toHaveLength(0);
    const after = await client.readContract({ address: tipToken, abi: erc20, functionName: "balanceOf", args: [keeperWallet.account.address] });
    const owedAfter = await client.readContract({ address: stack.ledger, abi: rebateLedgerAbi, functionName: "owed", args: [keeperWallet.account.address, tipToken] });
    // Delivery is best effort; a successful settlement may leave the tip safely claimable.
    expect(after + owedAfter).toBeGreaterThan(before + owedBefore);
    // The settlement's gas is on record for the keeper-balance alert.
    expect(keeper.spentSince(3_600)).toBeGreaterThan(0n);
  });

  it("drips vested value to LPs on its cadence", async () => {
    const st0 = await client.readContract({ address: stack.hook, abi: touchstoneHookAbi, functionName: "poolState", args: [stack.poolId] });
    expect(st0.vest0 + st0.vest1).toBeGreaterThan(0n);
    await advance(600);
    const report = await keeper.tick();
    expect(report.dripped).toBe(1);
    const st1 = await client.readContract({ address: stack.hook, abi: touchstoneHookAbi, functionName: "poolState", args: [stack.poolId] });
    expect(st1.vest0 + st1.vest1).toBeLessThan(st0.vest0 + st0.vest1);
  });

  it("settles a record it reaches after maxLag, because the update published by latest stays valid", async () => {
    await swapBuy(500_000n);
    let report = await keeper.tick();
    expect(report.ingested).toBe(1);
    await advance(30);
    report = await keeper.tick();
    expect(report.settled).toBe(1);
    expect(keeper.openRecords()).toHaveLength(0);
  });

  it("retries while Hermes has no update, then expires the record after its window", async () => {
    await swapBuy(20_000n);
    await keeper.tick();
    const [r] = keeper.openRecords();
    expect(r!.swapFeePips).toBe(500);
    expect(r).toBeDefined();
    notYet.add(r!.timestamp + 3);
    await advance(5);
    let report = await keeper.tick();
    expect(report.settled).toBe(0);
    expect(keeper.openRecords()).toHaveLength(1);

    await advance(3_600 + 10);
    report = await keeper.tick();
    expect(report.expired).toBe(1);
    const hash = await client.readContract({ address: stack.hook, abi: touchstoneHookAbi, functionName: "recordHash", args: [r!.poolId, r!.id] });
    expect(BigInt(hash)).toBe(0n);
  });

  /** Every RentCharged on the auction and RentCredited on the hook for the licence pool, summed. */
  async function rentTotals(): Promise<{ charged: bigint; credited: bigint }> {
    const [charged, credited] = await Promise.all([
      client.getContractEvents({ address: stack.licence, abi: licenceAuctionAbi, eventName: "RentCharged", args: { id: stack.licencePoolId }, fromBlock: 0n }),
      client.getContractEvents({ address: stack.hook, abi: touchstoneHookAbi, eventName: "RentCredited", args: { id: stack.licencePoolId }, fromBlock: 0n }),
    ]);
    return {
      charged: charged.reduce((sum, e) => sum + e.args.amount!, 0n),
      credited: credited.reduce((sum, e) => sum + e.args.amount!, 0n),
    };
  }

  it("accrues licence rent, and the hook credits exactly what the auction charged, through the lease's lapse (I12, I13)", async () => {
    const rent = 1_000n; // 0.001 USDC per second
    const k = BigInt(stack.leaseK);
    const deposit = rent * k * 20n;
    const owner = trader.account.address;
    const approve = await trader.writeContract({ address: stack.usdc, abi: erc20Abi, functionName: "approve", args: [stack.licence, deposit] });
    await client.waitForTransactionReceipt({ hash: approve });
    const bid = await trader.writeContract({ address: stack.licence, abi: licenceAuctionAbi, functionName: "bid", args: [stack.licencePoolId, owner, rent, deposit] });
    expect((await client.waitForTransactionReceipt({ hash: bid })).status).toBe("success");

    // Active after K seconds of notice; then ten minutes of rent.
    await advance(stack.leaseK + 600);
    const [holder, live] = await client.readContract({ address: stack.licence, abi: licenceAuctionAbi, functionName: "holderOf", args: [stack.licencePoolId] });
    expect(live).toBe(true);
    expect(holder.toLowerCase()).toBe(owner.toLowerCase());
    let report = await keeper.tick();
    expect(report.accrued).toBe(1);
    let totals = await rentTotals();
    expect(totals.charged).toBeGreaterThan(0n);
    expect(totals.credited).toBe(totals.charged);
    // I13: never more than rent for the seconds since activation (plus the blocks the keeper itself mined).
    expect(totals.charged).toBeLessThanOrEqual(rent * 620n);

    // Inside the interval the keeper leaves the auction alone.
    report = await keeper.tick();
    expect(report.accrued).toBe(0);

    // Past the lapse: leases() already reads empty, but the charged rent still waits in the auction; the keeper
    // must deliver it.
    await advance(Number(deposit / rent));
    const [, liveAfter] = await client.readContract({ address: stack.licence, abi: licenceAuctionAbi, functionName: "holderOf", args: [stack.licencePoolId] });
    expect(liveAfter).toBe(false);
    report = await keeper.tick();
    expect(report.accrued).toBe(1);
    totals = await rentTotals();
    expect(totals.charged).toBe(deposit);
    expect(totals.credited).toBe(deposit);
    const lapsed = await client.getContractEvents({ address: stack.licence, abi: licenceAuctionAbi, eventName: "LeaseLapsed", args: { id: stack.licencePoolId }, fromBlock: 0n });
    expect(lapsed).toHaveLength(1);
    const refund = await client.readContract({ address: stack.licence, abi: licenceAuctionAbi, functionName: "refunds", args: [owner, stack.usdc] });
    expect(refund).toBe(0n);

    // Nothing left to charge: the keeper sends no further transaction.
    await advance(ACCRUE_INTERVAL_S + 1);
    report = await keeper.tick();
    expect(report.accrued).toBe(0);
  });

  it("passes the wiring check for the deployed set and names every mismatch", async () => {
    const at = { hook: stack.hook, settler: stack.settler, factory: stack.factory, ledger: stack.ledger, licence: stack.licence };
    expect(await checkWiring(client, chain.id, at)).toEqual([]);
    expect(await checkWiring(client, chain.id + 1, at)).toEqual([`RPC serves chain ${chain.id}, configured ${chain.id + 1}`]);
    expect(await checkWiring(client, chain.id, { ...at, ledger: stack.settler })).toEqual(["hook.LEDGER differs from the configured ledger"]);
    expect(await checkWiring(client, chain.id, { ...at, licence: keeperWallet.account.address })).toEqual(["licence has no code"]);
  });
});
