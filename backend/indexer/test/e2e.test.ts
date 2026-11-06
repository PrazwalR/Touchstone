import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, createTestClient, createWalletClient, encodeAbiParameters, erc20Abi, http, parseAbiParameters, type Abi, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { decodeDepositTaken, licenceAuctionAbi, settlerAbi, touchstoneHookAbi } from "@touchstone/shared";
import { Indexer } from "../src/indexer.ts";
import { Store } from "../src/store.ts";

// Anvil's well-known development key (public, funded only on a local anvil).
const DEPLOYER_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const PORT = 8_548;
const RPC = `http://127.0.0.1:${PORT}`;
const contractsDir = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "contracts");

interface Stack {
  poolManager: Address;
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

describe.skipIf(!hasTool("anvil") || !hasTool("forge"))("indexer end to end on anvil", () => {
  let anvil: ChildProcess;
  let stack: Stack;
  const chain = { ...foundry, rpcUrls: { default: { http: [RPC] } } };
  const client = createPublicClient({ chain, transport: http(RPC) });
  const test = createTestClient({ chain, mode: "anvil", transport: http(RPC) });
  const wallet = createWalletClient({ chain, transport: http(RPC), account: privateKeyToAccount(DEPLOYER_KEY) });
  let swapAbi: Abi;
  let store: Store;
  let indexer: Indexer;

  beforeAll(async () => {
    swapAbi = (JSON.parse(readFileSync(join(contractsDir, "out", "PoolSwapTest.sol", "PoolSwapTest.json"), "utf8")) as { abi: Abi }).abi;
    store = new Store(":memory:");
    mkdirSync(join(contractsDir, "test", "integration", "out"), { recursive: true });
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
    indexer = new Indexer(
      client,
      store,
      {
        chain: "anvil",
        hook: stack.hook,
        settler: stack.settler,
        ledger: stack.ledger,
        factory: stack.factory,
        poolManager: stack.poolManager,
        licence: stack.licence,
        confirmations: 1n,
        startBlock: 0n,
        blockRange: 50n,
      },
      () => undefined,
    );
  }, 180_000);

  afterAll(() => {
    anvil?.kill();
    store?.close();
  });

  it("indexes registration, liquidity, a flagged swap and its settlement, once each", async () => {
    const key = {
      currency0: stack.quoteIs0 ? stack.usdc : stack.weth,
      currency1: stack.quoteIs0 ? stack.weth : stack.usdc,
      fee: 500,
      tickSpacing: 60,
      hooks: stack.hook,
    };
    const zeroForOne = stack.quoteIs0;
    const swapTx = await wallet.writeContract({
      address: stack.swapRouter,
      abi: swapAbi,
      functionName: "swap",
      args: [
        key,
        { zeroForOne, amountSpecified: -500_000_000_000n, sqrtPriceLimitX96: zeroForOne ? 4295128740n : 1461446703485210103287273052203988822378723970341n },
        { takeClaims: false, settleUsingBurn: false },
        "0x",
      ],
    });
    const receipt = await client.waitForTransactionReceipt({ hash: swapTx });
    const depositLog = receipt.logs.find((l) => l.address.toLowerCase() === stack.hook.toLowerCase());
    const record = decodeDepositTaken(depositLog!);
    expect(record).not.toBeNull();
    expect(record!.swapFeePips).toBe(500);

    // Settle directly through the Settler with a MockPythUnique-encoded update at t0.
    await test.increaseTime({ seconds: 5 });
    await test.mine({ blocks: 1 });
    const t0 = BigInt(record!.timestamp + 3);
    const feed = parseAbiParameters(
      "(bytes32 id, (int64 price, uint64 conf, int32 expo, uint256 publishTime) price, (int64 price, uint64 conf, int32 expo, uint256 publishTime) emaPrice) feed, uint64 prev",
    );
    const enc = (id: Hex, price: bigint) => {
      const p = { price, conf: 0n, expo: -8, publishTime: t0 };
      return encodeAbiParameters(feed, [{ id, price: p, emaPrice: p }, t0 - 1n]);
    };
    const settleTx = await wallet.writeContract({
      address: stack.settler,
      abi: settlerAbi,
      functionName: "settle",
      args: [record!, [enc(stack.baseId, 330_000_000_000n), enc(stack.quoteId, 100_000_000n)]],
      value: 2n,
    });
    expect((await client.waitForTransactionReceipt({ hash: settleTx })).status).toBe("success");
    await test.mine({ blocks: 2 });

    await indexer.tick();
    expect([...store.pools("anvil")].sort()).toEqual([stack.poolId.toLowerCase(), stack.licencePoolId.toLowerCase()].sort());
    expect(store.countByStatus("anvil")).toEqual({ settled: 1 });
    expect(store.countEvents("anvil", "DepositTaken")).toBe(1);
    expect(store.countEvents("anvil", "Settled")).toBe(1);
    expect(store.countEvents("anvil", "Swap")).toBe(1);
    expect(store.countEvents("anvil", "ModifyLiquidity")).toBe(1);

    // A second pass over the same range writes nothing new.
    const before = store.countEvents("anvil", "Swap");
    await test.mine({ blocks: 2 });
    await indexer.tick();
    expect(store.countEvents("anvil", "Swap")).toBe(before);
    const hash = await client.readContract({ address: stack.hook, abi: touchstoneHookAbi, functionName: "recordHash", args: [record!.poolId, record!.id] });
    expect(BigInt(hash)).toBe(0n);
  });

  it("detects a reorg below the cursor and re-reads idempotently", async () => {
    const snap = await test.snapshot();
    await test.mine({ blocks: 3 });
    await indexer.tick();
    await test.revert({ id: snap });
    await test.mine({ blocks: 5 });
    const res = await indexer.tick();
    expect(res).not.toBeNull();
    expect(store.countByStatus("anvil")).toEqual({ settled: 1 });
    expect(store.countEvents("anvil", "Swap")).toBe(1);
  });

  it("indexes a bid, its activation and the rent charged and credited, once each", async () => {
    const rent = 1_000n;
    const deposit = rent * BigInt(stack.leaseK) * 20n;
    const owner = wallet.account.address;
    await client.waitForTransactionReceipt({ hash: await wallet.writeContract({ address: stack.usdc, abi: erc20Abi, functionName: "approve", args: [stack.licence, deposit] }) });
    await client.waitForTransactionReceipt({ hash: await wallet.writeContract({ address: stack.licence, abi: licenceAuctionAbi, functionName: "bid", args: [stack.licencePoolId, owner, rent, deposit] }) });
    await test.increaseTime({ seconds: stack.leaseK + 300 });
    await test.mine({ blocks: 1 });
    const accrue = await wallet.writeContract({ address: stack.licence, abi: licenceAuctionAbi, functionName: "accrue", args: [stack.licencePoolId] });
    expect((await client.waitForTransactionReceipt({ hash: accrue })).status).toBe("success");
    await test.mine({ blocks: 2 });

    await indexer.tick();
    expect(store.countEvents("anvil", "BidPlaced")).toBe(1);
    expect(store.countEvents("anvil", "LeaseActivated")).toBe(1);
    expect(store.countEvents("anvil", "RentCharged")).toBe(1);
    expect(store.countEvents("anvil", "RentCredited")).toBe(1);
    await test.mine({ blocks: 2 });
    await indexer.tick();
    expect(store.countEvents("anvil", "RentCharged")).toBe(1);
  });
});
