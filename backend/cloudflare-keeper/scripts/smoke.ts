import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { privateKeyToAccount } from "viem/accounts";

// Real local workerd + SQLite, with only throwaway credentials and an unreachable RPC.
const dir = mkdtempSync(resolve(tmpdir(), "touchstone-cf-smoke-"));
const token = "local-test-token-".padEnd(64, "a");
const key = `0x${"0".repeat(63)}1` as const;
const address = `0x${"11".repeat(20)}`;
const priceId = `0x${"22".repeat(32)}`;
const port = 18799;
const base = `http://127.0.0.1:${port}`;
const config = resolve(dir, "wrangler.json");
let rpcFails = true;
const blockHash = `0x${"33".repeat(32)}`;
const rpc = createServer(async (request, response) => {
  const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk));
  const body = JSON.parse(Buffer.concat(chunks).toString()) as { id: number; method: string };
  const result: Record<string, unknown> = {
    eth_chainId: "0x66eee", eth_getCode: "0x01", eth_call: `0x${address.slice(2).padStart(64, "0")}`,
    eth_blockNumber: "0x1", eth_getLogs: [], eth_getBlockByNumber: {
      number: "0x1", hash: blockHash, parentHash: blockHash, timestamp: "0x64", transactions: [], uncles: [],
      gasLimit: "0x1000000", gasUsed: "0x0", difficulty: "0x0", totalDifficulty: "0x0", baseFeePerGas: "0x1",
      nonce: "0x0000000000000000", extraData: "0x", miner: address,
    },
  };
  response.setHeader("content-type", "application/json");
  response.end(JSON.stringify(rpcFails || !(body.method in result)
    ? { jsonrpc: "2.0", id: body.id, error: { code: -32603, message: "test RPC unavailable" } }
    : { jsonrpc: "2.0", id: body.id, result: result[body.method] }));
});
await new Promise<void>(r => rpc.listen(0, "127.0.0.1", r));
const rpcPort = (rpc.address() as { port: number }).port;
writeFileSync(config, JSON.stringify({ name: "touchstone-local-test", main: resolve("src/index.ts"),
  compatibility_date: "2026-11-01", compatibility_flags: ["nodejs_compat"],
  durable_objects: { bindings: [{ name: "KEEPER", class_name: "KeeperObject" }] },
  migrations: [{ tag: "v1", new_sqlite_classes: ["KeeperObject"] }],
  vars: {
    ADMIN_TOKEN: token, KEEPER_PRIVATE_KEY: key, KEEPER_EXPECTED_ADDRESS: privateKeyToAccount(key).address,
    KEEPER_RPC_URL: `http://127.0.0.1:${rpcPort}`, KEEPER_CHAIN_ID: "421614",
    KEEPER_START_BLOCK: "1", KEEPER_LOG_BLOCK_RANGE: "10", KEEPER_POLL_INTERVAL_MS: "3000",
    KEEPER_MIN_MARGIN_BPS: "0", KEEPER_SETTLE_AT_LOSS: "true", KEEPER_DRIPS_PER_PERIOD: "10",
    KEEPER_NATIVE_PRICE_ID: priceId, KEEPER_PUSH_RECIPIENTS: "", HERMES_URL: "http://127.0.0.1:1",
    HERMES_API_KEY: "fake-test-only", HERMES_API_KEY_HEADER: "Authorization", HERMES_TIMEOUT_MS: "1000",
    TOUCHSTONE_HOOK: address, TOUCHSTONE_SETTLER: address, TOUCHSTONE_FACTORY: address, TOUCHSTONE_LEDGER: address,
    CF_IDLE_POLL_MS: "30000", CF_ACTIVE_POLL_MS: "3000", CF_ERROR_POLL_MS: "30000", CF_HOUSEKEEPING: "false",
  } }));
let child: ChildProcess | undefined;
let output = "";
const pause = (ms: number) => new Promise(r => setTimeout(r, ms));
async function launch() {
  child = spawn("pnpm", ["exec", "wrangler", "dev", "--config", config, "--port", String(port), "--ip", "127.0.0.1", "--persist-to", resolve(dir, "state")],
    { stdio: ["ignore", "pipe", "pipe"], detached: true });
  child.stdout?.on("data", data => { output += String(data); }); child.stderr?.on("data", data => { output += String(data); });
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(`${base}/health`)).ok) return; } catch { /* not listening yet */ }
    if (child.exitCode !== null) throw Error(output);
    await pause(200);
  }
  throw Error(`Local Worker did not start: ${output}`);
}
async function shutdown() {
  if (!child?.pid) return;
  if (child.exitCode !== null || child.signalCode !== null) { child = undefined; return; }
  const exited = new Promise<void>(r => child!.once("exit", () => r()));
  try { process.kill(-child.pid, "SIGTERM"); } catch { /* already stopped */ }
  await Promise.race([exited, pause(3000)]);
  try { process.kill(-child.pid, "SIGKILL"); } catch { /* exited normally */ }
  child = undefined; await pause(300);
}
async function call(path: string, method = "GET") {
  return fetch(base + path, { method, headers: { authorization: `Bearer ${token}` } });
}
try {
  await launch();
  assert.equal((await fetch(`${base}/status`)).status, 401);
  assert.equal((await fetch(`${base}/start`, { method: "POST" })).status, 401);
  assert.equal((await call("/status")).status, 200);
  assert.equal((await call("/start", "POST")).status, 200);
  await pause(2500);
  const status = await (await call("/status")).json() as { enabled: boolean; nextAlarm: number; lastTick: { ok: boolean; error: string } };
  assert.equal(status.enabled, true);
  assert.equal(status.lastTick.ok, false);
  assert.equal(status.lastTick.error, "keeper_tick_failed");
  assert.ok(status.nextAlarm > Date.now());
  rpcFails = false;
  assert.equal((await call("/start", "POST")).status, 200);
  await pause(2500);
  const healthy = await (await call("/status")).json() as { nextBlock: string; lastTick: { ok: boolean } };
  assert.equal(healthy.lastTick.ok, true); assert.equal(healthy.nextBlock, "2");
  assert.equal((await call("/stop", "POST")).status, 200);
  await shutdown(); await launch();
  const restarted = await (await call("/status")).json() as { enabled: boolean; nextAlarm: number | null; nextBlock: string; lastTick: unknown };
  assert.equal(restarted.enabled, false); assert.equal(restarted.nextAlarm, null); assert.ok(restarted.lastTick);
  assert.equal(restarted.nextBlock, "2");
  console.log("Local workerd smoke passed: authentication, RPC failure recovery, successful core tick, bigint cursor checkpoint, stop, SQLite restart persistence.");
} finally { await shutdown(); rpc.closeAllConnections(); await new Promise<void>(r => rpc.close(() => r())); rmSync(dir, { recursive: true, force: true }); }
