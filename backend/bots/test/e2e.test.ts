import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, createTestClient, createWalletClient, defineChain, erc20Abi, http, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { licenceAuctionAbi } from "@touchstone/shared";

// Anvil's well-known development keys (public, funded only on a local anvil).
const DEPLOYER_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const OTHER = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const PORT = 8_549;
// The bots run only on the two testnets, so this anvil answers with Base Sepolia's chain id.
const CHAIN_ID = 84_532;
const RPC = `http://127.0.0.1:${PORT}`;
const here = fileURLToPath(new URL(".", import.meta.url));
const contractsDir = join(here, "..", "..", "..", "contracts");

interface Stack {
  poolManager: Address;
  guardedRouter: Address;
  hook: Address;
  licence: Address;
  usdc: Address;
  weth: Address;
  quoteIs0: boolean;
  baseId: Hex;
  quoteId: Hex;
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

describe.skipIf(!hasTool("anvil") || !hasTool("forge"))("licence bots on anvil", () => {
  let anvil: ChildProcess;
  let stack: Stack;
  let dir: string;
  const chain = defineChain({ id: CHAIN_ID, name: "anvil", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [RPC] } } });
  const client = createPublicClient({ chain, transport: http(RPC) });
  const test = createTestClient({ chain, mode: "anvil", transport: http(RPC) });
  const deployer = createWalletClient({ chain, transport: http(RPC), account: privateKeyToAccount(DEPLOYER_KEY) });

  /** Runs one bot round in simulate-only mode (no key is loaded) and returns its structured log lines. */
  function bot(mode: "bidder" | "holder", account: Address): Record<string, unknown>[] {
    let out: string;
    try {
      out = execFileSync("node", ["src/main.ts"], {
        cwd: join(here, ".."),
        encoding: "utf8",
        env: {
          PATH: process.env.PATH,
          BOT_RPC_URL: RPC,
          BOT_CHAIN_ID: String(CHAIN_ID),
          BOT_MODE: mode,
          BOT_SEED: "7",
          BOT_SUBMIT: "false",
          BOT_ACCOUNT: account,
          BOT_KEYSTORE_PATH: join(dir, "unused-keystore"),
          BOT_PASSWORD_FILE: join(dir, "unused-password"),
          BOT_DEPLOYMENT_FILE: join(dir, "deployment.json"),
          BOT_ZERO_FOR_ONE: String(stack.quoteIs0),
          BOT_AMOUNT_MIN: "1000000",
          BOT_AMOUNT_MAX: "2000000",
          BOT_MIN_NET_OUT: "1",
          BOT_MIN_GROSS_OUT: "1",
          BOT_MAX_DEPOSIT: "0",
          BOT_SQRT_PRICE_LIMIT_X96: "4295128740",
          BOT_DEADLINE_SECONDS: "60",
          BOT_ITERATIONS: "1",
          BOT_INTERVAL_MS: "1",
          BOT_MAX_GAS: "1000000",
          BOT_MAX_GAS_PRICE_WEI: "100000000000",
          BOT_MIN_EDGE_BPS: "10",
          BOT_PRICE_MAX_AGE_SECONDS: "60",
          BOT_MAX_CONF_BPS: "25",
          BOT_LEASE_MAX_RENT: "100",
          BOT_LEASE_SECONDS: "3600",
          BOT_LEASE_MAX_DEPOSIT: "1000000",
          HERMES_URL: "http://127.0.0.1:1",
          HERMES_API_KEY: "fixture-unused-hermes-credential",
          HERMES_API_KEY_HEADER: "x-api-key",
          HERMES_TIMEOUT_MS: "1000",
        },
      });
    } catch (err) {
      throw new Error(`bot exited with an error: ${String((err as { stdout?: string }).stdout ?? err)}`);
    }
    return out.trim().split("\n").map((l) => JSON.parse(l) as Record<string, unknown>);
  }

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "touchstone-bots-"));
    mkdirSync(join(contractsDir, "test", "integration", "out"), { recursive: true });
    anvil = spawn("anvil", ["--port", String(PORT), "--chain-id", String(CHAIN_ID), "--silent", "--disable-code-size-limit"], { stdio: "ignore" });
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
    const [c0, c1] = stack.quoteIs0 ? [stack.usdc, stack.weth] : [stack.weth, stack.usdc];
    writeFileSync(
      join(dir, "deployment.json"),
      JSON.stringify({
        chainId: CHAIN_ID,
        contracts: { hook: stack.hook, guardedRouter: stack.guardedRouter, licenceAuction: stack.licence },
        // StateView is read only by the swapping modes, which these tests stop before any price read.
        uniswap: { stateView: stack.poolManager, poolManager: stack.poolManager },
        oracles: { pythEthUsdId: stack.baseId, pythUsdcUsdId: stack.quoteId },
        tokens: { risky: { address: stack.weth, decimals: 18 }, quote: { address: stack.usdc, decimals: 6 } },
        pools: [{ poolId: stack.licencePoolId, currency0: c0, currency1: c1, hooks: stack.hook, fee: 3_000, tickSpacing: 60 }],
      }),
    );
  }, 180_000);

  afterAll(() => {
    anvil?.kill();
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it("refuses to bid past its allowance, then simulates the smallest valid bid", async () => {
    expect(() => bot("bidder", deployer.account.address)).toThrow();
    await client.waitForTransactionReceipt({
      hash: await deployer.writeContract({ address: stack.usdc, abi: erc20Abi, functionName: "approve", args: [stack.licence, 1_000_000n] }),
    });
    const lines = bot("bidder", deployer.account.address);
    const bid = lines.find((l) => l.msg === "bid simulated");
    // minRent is 1 base unit per second; the deposit covers BOT_LEASE_SECONDS of it.
    expect(bid).toMatchObject({ rent: "1", deposit: "3600", submitted: false });
  });

  it("never outbids itself, and the holder bot trades only while it holds the licence", async () => {
    await client.waitForTransactionReceipt({
      hash: await deployer.writeContract({ address: stack.licence, abi: licenceAuctionAbi, functionName: "bid", args: [stack.licencePoolId, deployer.account.address, 1n, 3_600n] }),
    });
    expect(bot("bidder", deployer.account.address).find((l) => l.msg === "no bid")).toMatchObject({ reason: "already pending" });
    await test.increaseTime({ seconds: stack.leaseK + 1 });
    await test.mine({ blocks: 1 });
    expect(bot("bidder", deployer.account.address).find((l) => l.msg === "no bid")).toMatchObject({ reason: "already holder" });
    expect(bot("holder", OTHER).some((l) => l.msg === "not the live licence holder")).toBe(true);
  });
});
