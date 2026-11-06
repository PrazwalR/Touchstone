import { execFileSync, spawn, type ChildProcess } from "node:child_process";
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
  type Abi,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { confirmedReasons } from "../src/swap/recordSettlement.ts";
import { settlerAbi } from "../abi/index.ts";
import { approveExact, executeSwap, guardFor, previewSwap, priceImpactBps, recordOutcome, type SwapContext } from "../src/swap/swap.ts";

// Anvil's first development key: public, funded only on a local anvil.
const KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const PORT = 8_551;
const RPC = `http://127.0.0.1:${PORT}`;
const contracts = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "contracts");

interface Stack {
  poolManager: Address;
  guardedRouter: Address;
  hook: Address;
  settler: Address;
  usdc: Address;
  weth: Address;
  quoteIs0: boolean;
  baseId: Hex;
  quoteId: Hex;
  poolId: Hex;
}

const hasTool = (bin: string): boolean => {
  try {
    execFileSync(bin, ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
};

describe.skipIf(!hasTool("anvil") || !hasTool("forge"))("swap module against a local Touchstone", () => {
  let anvil: ChildProcess;
  let stack: Stack;
  let ctx: SwapContext;
  const chain = { ...foundry, rpcUrls: { default: { http: [RPC] } } };
  const client = createPublicClient({ chain, transport: http(RPC) });
  const test = createTestClient({ chain, mode: "anvil", transport: http(RPC) });
  const wallet = createWalletClient({ chain, transport: http(RPC), account: privateKeyToAccount(KEY) });

  beforeAll(async () => {
    mkdirSync(join(contracts, "test", "integration", "out"), { recursive: true });
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
      ["script", "test/integration/LocalStack.s.sol", "--rpc-url", RPC, "--broadcast", "--disable-code-size-limit", "--private-key", KEY],
      { cwd: contracts, stdio: "ignore", env: { ...process.env, STACK_OUT: `test/integration/out/stack-${PORT}.json` } },
    );
    stack = JSON.parse(readFileSync(join(contracts, "test", "integration", "out", `stack-${PORT}.json`), "utf8")) as Stack;
    // Uniswap's V4Quoter, as deployed on every chain; LocalStack does not ship one.
    const artifact = JSON.parse(readFileSync(join(contracts, "out", "V4Quoter.sol", "V4Quoter.json"), "utf8")) as {
      abi: Abi;
      bytecode: { object: Hex };
    };
    const deployHash = await wallet.deployContract({ abi: artifact.abi, bytecode: artifact.bytecode.object, args: [stack.poolManager] });
    const quoter = (await client.waitForTransactionReceipt({ hash: deployHash })).contractAddress!;
    ctx = {
      client,
      manager: stack.poolManager,
      hook: stack.hook,
      settler: stack.settler,
      router: stack.guardedRouter,
      quoter,
      key: {
        currency0: stack.quoteIs0 ? stack.usdc : stack.weth,
        currency1: stack.quoteIs0 ? stack.weth : stack.usdc,
        fee: 500,
        tickSpacing: 60,
        hooks: stack.hook,
      },
      poolId: stack.poolId,
      risky: { symbol: "WETH", address: stack.weth, decimals: 18 },
      quote: { symbol: "USDC", address: stack.usdc, decimals: 6 },
    };
  }, 180_000);

  afterAll(() => {
    anvil?.kill();
  });

  it("quotes, approves exactly, swaps within the guard, and follows the record to settlement", async () => {
    const me = wallet.account.address;
    const amountIn = 20_000n * 10n ** 6n; // above the stack's N0 of $5,000: a first-touch large swap is flagged
    await test.mine({ blocks: 1 });

    const before = await previewSwap(ctx, "buy", amountIn, me);
    expect(before.deposit.flaggedNow).toBe(true);
    expect(before.needsApproval).toBe(true);
    expect(before.exact).toBeNull();
    expect(before.netOut).toBeGreaterThan(0n);

    await approveExact(ctx, wallet, ctx.quote, amountIn);
    const p = await previewSwap(ctx, "buy", amountIn, me);
    expect(p.needsApproval).toBe(false);
    expect(p.exact).not.toBeNull();
    // V4Quoter runs the same swap, hook included, so both measure the same output net of the deposit.
    expect(p.exact!.netOut).toBe(p.netOut);
    expect(p.exact!.deposit).toBeGreaterThan(0n);
    expect(p.exact!.deposit).toBeLessThanOrEqual(p.depositBound + 1n);
    // $20,000 into a constant-product pool $10 million deep on the quote side: the average execution price is
    // about 20,000 / 10,000,000 = 20 bps off spot, plus the 5 bps fee, so about 25 bps.
    const impact = priceImpactBps(ctx, p);
    expect(impact).toBeGreaterThanOrEqual(20);
    expect(impact).toBeLessThanOrEqual(30);

    const block = await client.getBlock();
    const guard = guardFor(p, 50n);
    const result = await executeSwap(ctx, wallet, "buy", amountIn, guard, block.timestamp + 600n);
    expect(result.paid).toBe(amountIn);
    expect(result.received).toBe(p.exact!.netOut);
    expect(result.record).not.toBeNull();
    expect(result.record!.deposit).toBe(p.exact!.deposit);
    expect(result.record!.beneficiary.toLowerCase()).toBe(me.toLowerCase());
    // The approval covered this swap exactly and is spent.
    expect(await client.readContract({ address: stack.usdc, abi: erc20Abi, functionName: "allowance", args: [me, stack.guardedRouter] })).toBe(0n);

    const r = result.record!;
    expect(confirmedReasons(ctx.hook, result.receipt, r.poolId, r.id)).toBe(1);
    expect(confirmedReasons(ctx.hook, { ...result.receipt, logs: [] }, r.poolId, r.id)).toBeNull();
    expect(confirmedReasons(ctx.hook, result.receipt, r.poolId, r.id + 1n)).toBeNull();
    expect((await recordOutcome(ctx, r.poolId, r.id, result.receipt.blockNumber)).kind).toBe("open");

    // Settle as a keeper would, with MockPythUnique-encoded updates at t0.
    await test.increaseTime({ seconds: 5 });
    await test.mine({ blocks: 1 });
    const t0 = BigInt(r.timestamp + 3);
    const feed = parseAbiParameters(
      "(bytes32 id, (int64 price, uint64 conf, int32 expo, uint256 publishTime) price, (int64 price, uint64 conf, int32 expo, uint256 publishTime) emaPrice) feed, uint64 prev",
    );
    const enc = (id: Hex, price: bigint) => {
      const pr = { price, conf: 0n, expo: -8, publishTime: t0 };
      return encodeAbiParameters(feed, [{ id, price: pr, emaPrice: pr }, t0 - 1n]);
    };
    const settle = await wallet.writeContract({
      address: stack.settler,
      abi: settlerAbi,
      functionName: "settle",
      args: [r.raw as never, [enc(stack.baseId, 300_000_000_000n), enc(stack.quoteId, 100_000_000n)]],
      value: 2n,
    });
    expect((await client.waitForTransactionReceipt({ hash: settle })).status).toBe("success");

    const outcome = await recordOutcome(ctx, r.poolId, r.id, result.receipt.blockNumber);
    expect(outcome.kind).toBe("settled");
    if (outcome.kind === "settled") {
      const pay = outcome.payout;
      const total = pay.refund + pay.tip + pay.toProtocol + pay.toRebatePool + pay.toLPs;
      expect(pay.benign ? pay.refund : total).toBe(r.deposit);
    }
  });

  it.each(["buy", "sell"] as const)("caps payment and delivers exact output for a %s", async (side) => {
    const requested = side === "buy" ? 3n * 10n ** 18n : 8000n * 10n ** 6n;
    const me = wallet.account.address;
    const quote = await previewSwap(ctx, side, requested, me, true);
    const limit = guardFor(quote, 50n);
    await approveExact(ctx, wallet, side === "buy" ? ctx.quote : ctx.risky, limit.maxNetIn);
    const preview = await previewSwap(ctx, side, requested, me, true);
    expect(preview.exact?.netOut).toBe(requested);
    const guard = guardFor(preview, 50n);
    const deadline = (await client.getBlock()).timestamp + 600n;
    const tooLow = { ...guard, maxNetIn: preview.exact!.netIn - 1n };
    await expect(executeSwap(ctx, wallet, side, requested, tooLow, deadline, true)).rejects.toThrow();
    const result = await executeSwap(ctx, wallet, side, requested, guard, deadline, true);
    expect(result.received).toBe(requested);
    expect(result.paid).toBeLessThanOrEqual(guard.maxNetIn);
    expect(result.record!.deposit).toBeGreaterThan(0n);
    expect(result.record!.depositIn0).toBe(preview.zeroForOne);
  });

  it("refuses a guard the swap cannot meet, on chain, before anything moves", async () => {
    const me = wallet.account.address;
    const amountIn = 1_000n * 10n ** 6n;
    await test.mine({ blocks: 1 });
    await approveExact(ctx, wallet, ctx.quote, amountIn);
    const p = await previewSwap(ctx, "buy", amountIn, me);
    const greedy = { ...guardFor(p, 0n), minNetOut: p.netOut + 1n, minGrossOut: p.netOut + 1n };
    const block = await client.getBlock();
    await expect(executeSwap(ctx, wallet, "buy", amountIn, greedy, block.timestamp + 600n)).rejects.toThrow();
  });
});
