import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Server } from "node:http";
import { Store } from "../src/store.ts";
import { History } from "../src/history.ts";
import { historyServer, type ApiConfig } from "../src/api.ts";

const poolId = `0x${"ab".repeat(32)}`;
const recipient = `0x${"cd".repeat(20)}`;
const cfg: ApiConfig = {
  INDEXER_API_HOST: "127.0.0.1",
  INDEXER_API_PORT: 1,
  INDEXER_API_ORIGINS: ["https://dashboard.example"],
  INDEXER_API_REQUESTS_PER_WINDOW: 100,
  INDEXER_API_WINDOW_MS: 60_000,
  INDEXER_API_MAX_CLIENTS: 10,
  INDEXER_API_MAX_PAGE_SIZE: 50,
  INDEXER_CHAIN: "arbitrum-sepolia",
  INDEXER_DATABASE_PATH: "unused",
};
const cleanup: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const fn of cleanup.splice(0).reverse()) await fn();
});
async function setup(
  overrides: Partial<ApiConfig> = {},
): Promise<{ url: string; history: History; store: Store }> {
  const dir = mkdtempSync(join(tmpdir(), "touchstone-api-"));
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, "index.sqlite");
  const store = new Store(path);
  cleanup.push(() => store.close());
  store.addEvent({
    chain: cfg.INDEXER_CHAIN,
    txHash: "0x01",
    logIndex: 0,
    blockNumber: 5n,
    contract: "0x02",
    name: "Settled",
    args: {
      id: poolId,
      recordId: 7n,
      fairPriceX36: 10n ** 36n,
      payout: { refund: 10n ** 25n },
    },
  });
  store.addEvent({
    chain: cfg.INDEXER_CHAIN,
    txHash: "0x02",
    logIndex: 1,
    blockNumber: 6n,
    contract: "0x03",
    name: "Credited",
    args: { recipient, currency: "0x04", amount: 10n ** 30n, kind: 0 },
  });
  const history = new History(path, cfg.INDEXER_CHAIN);
  cleanup.push(() => history.close());
  const server: Server = historyServer(history, { ...cfg, ...overrides });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  cleanup.push(
    () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((e) => (e ? reject(e) : resolve()));
      }),
  );
  const addr = server.address();
  if (addr === null || typeof addr === "string") throw new Error("no listener");
  return { url: `http://127.0.0.1:${addr.port}`, history, store };
}
describe("read-only history API", () => {
  it("preserves exact payout integers and filters the record", async () => {
    const { url } = await setup();
    const res = await fetch(`${url}/v1/records?poolId=${poolId}&recordId=7`);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.items[0].args.payout.refund).toBe((10n ** 25n).toString());
    expect(
      (await (await fetch(`${url}/v1/records?recordId=8`)).json()).items,
    ).toEqual([]);
  });
  it("rejects unknown, duplicate, injected and excessive parameters", async () => {
    const { url } = await setup();
    for (const query of [
      "limit=51",
      "offset=-1",
      "limit=1&limit=2",
      "poolId=' OR 1=1",
      "unexpected=1",
      "recordId=18446744073709551616",
    ]) {
      expect((await fetch(`${url}/v1/records?${query}`)).status).toBe(400);
    }
  });
  it("enforces methods and CORS and never leaks database errors", async () => {
    const { url, history } = await setup();
    expect((await fetch(`${url}/v1/records`, { method: "POST" })).status).toBe(
      405,
    );
    expect(
      (
        await fetch(`${url}/v1/records`, {
          headers: { Origin: "https://evil.example" },
        })
      ).status,
    ).toBe(403);
    const ok = await fetch(`${url}/v1/health`, {
      headers: { Origin: cfg.INDEXER_API_ORIGINS[0]! },
    });
    expect(ok.headers.get("access-control-allow-origin")).toBe(
      cfg.INDEXER_API_ORIGINS[0],
    );
    expect((await ok.json()).lpNetEstimate).toBeNull();
    history.close();
    cleanup.splice(cleanup.length - 2, 1);
    const failed = await fetch(`${url}/v1/records`);
    expect(failed.status).toBe(503);
    expect(await failed.json()).toEqual({ error: "history unavailable" });
  });
  it("limits requests without trusting spoofed forwarding headers", async () => {
    const { url } = await setup({ INDEXER_API_REQUESTS_PER_WINDOW: 1 });
    expect((await fetch(`${url}/v1/health`)).status).toBe(200);
    expect(
      (
        await fetch(`${url}/v1/health`, {
          headers: { "X-Forwarded-For": "another" },
        })
      ).status,
    ).toBe(429);
  });
  it("reads credits and follows the indexer's rewind", async () => {
    const { url, store } = await setup();
    expect(
      (await (await fetch(`${url}/v1/ledger?recipient=${recipient}`)).json())
        .items,
    ).toHaveLength(1);
    store.rewind(cfg.INDEXER_CHAIN, 5n);
    expect((await (await fetch(`${url}/v1/records`)).json()).items).toEqual([]);
  });
  it("does not create a missing database", () => {
    expect(
      () =>
        new History(
          `/nonexistent-touchstone-${Date.now()}/db.sqlite`,
          cfg.INDEXER_CHAIN,
        ),
    ).toThrow();
  });
});

it("measures lag from the confirmed closure header and clears it on rewind", async () => {
  const { url, store } = await setup();
  const record = {
    poolId,
    id: 7n,
    deposit: 1n,
    depositIn0: true,
    beneficiary: recipient,
  } as unknown as import("@touchstone/shared").TouchstoneRecord;
  store.openRecord(cfg.INDEXER_CHAIN, 3n, record);
  store.addEvent({
    chain: cfg.INDEXER_CHAIN,
    txHash: "0x03",
    logIndex: 0,
    blockNumber: 3n,
    contract: "0x02",
    name: "DepositTaken",
    args: { id: poolId, recordId: 7n, record: { timestamp: 100 } },
  });
  store.closeRecord(cfg.INDEXER_CHAIN, poolId, 7n, "settled", 5n);
  store.saveBlock(cfg.INDEXER_CHAIN, 5n, "0x05", 107n);
  expect(
    (await (await fetch(`${url}/v1/health`)).json()).settlementLagSeconds,
  ).toEqual({ count: 1, median: 7, p95: 7, sampleLimit: 1000 });
  store.rewind(cfg.INDEXER_CHAIN, 5n);
  expect(
    (await (await fetch(`${url}/v1/health`)).json()).settlementLagSeconds,
  ).toBeNull();
});

describe("licence history", () => {
  const owner = `0x${"ef".repeat(20)}`;
  const big = 2n ** 200n;
  function seed(store: Store): void {
    const add = (logIndex: number, block: bigint, name: string, args: Record<string, unknown>) =>
      store.addEvent({ chain: cfg.INDEXER_CHAIN, txHash: `0x1${logIndex}`, logIndex, blockNumber: block, contract: "0x09", name, args });
    add(0, 10n, "BidPlaced", { id: poolId, owner, swapper: owner, rent: 5n, deposit: 300n, activatesAt: 70n });
    add(1, 11n, "LeaseActivated", { id: poolId, owner, swapper: owner, rent: 5n });
    // Amounts beyond SQL's 64-bit integers must still sum exactly.
    add(2, 12n, "RentCharged", { id: poolId, amount: big });
    add(3, 12n, "RentCredited", { id: poolId, amount: big, toRebatePool: big / 10n, toVesting: big - big / 10n });
    add(4, 13n, "RentCharged", { id: poolId, amount: 7n });
    add(5, 14n, "LeaseLapsed", { id: poolId, owner, at: 99n });
    add(6, 14n, "BidPlaced", { id: `0x${"aa".repeat(32)}`, owner: recipient, swapper: recipient, rent: 1n, deposit: 60n, activatesAt: 80n });
  }

  it("lists a pool's licence events, filtered by pool and owner", async () => {
    const { url, store } = await setup();
    seed(store);
    const all = await (await fetch(`${url}/v1/licence?poolId=${poolId}&limit=50`)).json();
    expect(all.items.map((e: { name: string }) => e.name)).toEqual([
      "LeaseLapsed",
      "RentCharged",
      "RentCredited",
      "RentCharged",
      "LeaseActivated",
      "BidPlaced",
    ]);
    const byOwner = await (await fetch(`${url}/v1/licence?owner=${recipient}`)).json();
    expect(byOwner.items).toHaveLength(1);
    expect(byOwner.items[0].args.rent).toBe("1");
    // Licence events never leak into records, and records never into licence.
    const records = await (await fetch(`${url}/v1/records?poolId=${poolId}`)).json();
    expect(records.items.every((e: { name: string }) => e.name === "Settled")).toBe(true);
  });

  it("sums rent exactly and reports what is still in flight", async () => {
    const { url, store } = await setup();
    seed(store);
    const res = await fetch(`${url}/v1/licence/summary?poolId=${poolId.toUpperCase().replace("0X", "0x")}`);
    expect(res.status).toBe(200);
    const s = await res.json();
    expect(s.rentCharged).toBe((big + 7n).toString());
    expect(s.rentCredited).toBe(big.toString());
    expect(s.rentInFlight).toBe("7");
    expect(s.toRebatePool).toBe((big / 10n).toString());
    expect(s.counts.BidPlaced).toBe(1);
    expect(s.counts.LeaseLapsed).toBe(1);
    expect(s.lastActivation.args.owner).toBe(owner);
    expect(s.lastLapse.block).toBe("14");
    expect(s.label).toBe("measured indexed events");
  });

  it("rejects a summary without exactly one valid pool", async () => {
    const { url } = await setup();
    for (const q of ["", "poolId=0x12", `poolId=${poolId}&owner=${recipient}`])
      expect((await fetch(`${url}/v1/licence/summary?${q}`)).status).toBe(400);
    expect((await fetch(`${url}/v1/licence?recipient=${recipient}`)).status).toBe(400);
  });
});
