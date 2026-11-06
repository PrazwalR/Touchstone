import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Alerter, discordSink, discordWebhook, evaluate, MonitorReader, type Observation } from "../src/monitor.ts";
import { Store } from "../src/store.ts";

const pool = `0x${"ab".repeat(32)}`;
const t = { lagSlackS: 30, hermesErrorBps: 100, hermesMinRequests: 50, leaseWarnS: 3_600, keeperStaleS: 300, minKeeperBalanceWei: 10n ** 15n };
const quiet: Observation = {
  wallNow: 10_000,
  chainNow: 10_000,
  lag: [{ poolId: pool, settleDelay: 3, p95: 33, count: 20 }],
  expiries: [],
  deferred: [],
  keeper: { updatedAt: 9_900, balanceWei: 10n ** 17n, spent24hWei: 10n ** 16n, requests: 100, errors: 1, windowSeconds: 3_600 },
  leases: [{ poolId: pool, lapsesAt: 20_000, activatesAt: null }],
};
const keys = (o: Observation) => evaluate(o, t).map((a) => a.key.split(":").slice(0, 2).join(":"));

describe("alert rules (spec 15.6)", () => {
  it("is quiet exactly at every threshold", () => expect(evaluate(quiet, t)).toEqual([]));
  it("fires one second past the settlement-lag line", () =>
    expect(keys({ ...quiet, lag: [{ ...quiet.lag[0]!, p95: 34 }] })).toEqual([`lag:${pool}`]));
  it("reports every expiry and every deferred refund", () =>
    expect(keys({ ...quiet, expiries: [{ poolId: pool, recordId: "7", refund: "5", tx: "0x1" }], deferred: [{ poolId: pool, recordId: "8", amount: "9", tx: "0x2" }] })).toEqual([
      `expiry:${pool}`,
      `deferred:${pool}`,
    ]));
  it("watches the keeper: missing, stale, short of a day of gas, Hermes failing", () => {
    expect(keys({ ...quiet, keeper: null })).toEqual(["keeper:missing"]);
    const k = quiet.keeper!;
    expect(keys({ ...quiet, keeper: { ...k, updatedAt: 9_699 } })).toEqual(["keeper:stale"]);
    expect(keys({ ...quiet, keeper: { ...k, balanceWei: 10n ** 16n - 1n } })).toEqual(["keeper:balance"]);
    // With no day of spend yet, the configured floor applies.
    expect(keys({ ...quiet, keeper: { ...k, spent24hWei: 0n, balanceWei: 10n ** 15n - 1n } })).toEqual(["keeper:balance"]);
    expect(keys({ ...quiet, keeper: { ...k, errors: 2 } })).toEqual(["hermes:errors"]);
    // Too few requests to judge a rate.
    expect(keys({ ...quiet, keeper: { ...k, requests: 49, errors: 49 } })).toEqual([]);
  });
  it("warns before a lease runs out and before a pending bid takes over", () => {
    expect(keys({ ...quiet, leases: [{ poolId: pool, lapsesAt: 13_600, activatesAt: 12_000 }] })).toEqual(["lease:lapse", "lease:bid"]);
    expect(keys({ ...quiet, leases: [{ poolId: pool, lapsesAt: 13_601, activatesAt: 13_601 }] })).toEqual([]);
  });
});

describe("alerter", () => {
  it("sends once, repeats after the cooldown, resolves when clear, and never repeats an event", async () => {
    const sent: string[][] = [];
    const a = new Alerter(async (l) => void sent.push(l), 600);
    const cond = { key: "keeper:stale", once: false, text: "stale" };
    const event = { key: "expiry:x:1", once: true, text: "expired" };
    expect(await a.report([cond, event], 0)).toBe(2);
    expect(await a.report([cond, event], 599)).toBe(0);
    expect(await a.report([cond, event], 600)).toBe(1);
    expect(await a.report([], 700)).toBe(1);
    expect(sent.map((s) => s.map((l) => l.split(" ")[0]))).toEqual([["ALERT", "ALERT"], ["STILL"], ["RESOLVED"]]);
  });
});

describe("discord sink", () => {
  it("accepts only Discord webhook URLs", () => {
    expect(discordWebhook.safeParse("https://discord.com/api/webhooks/123/abc-DEF_9").success).toBe(true);
    expect(discordWebhook.safeParse("https://canary.discord.com/api/webhooks/1/x").success).toBe(true);
    for (const bad of ["http://discord.com/api/webhooks/1/x", "https://evil.example/api/webhooks/1/x", "https://discord.com.evil.example/api/webhooks/1/x", "https://discord.com/api/other"])
      expect(discordWebhook.safeParse(bad).success).toBe(false);
  });
  it("splits long batches under 2,000 characters, disables mentions, and retries once on 429", async () => {
    const bodies: { content: string; allowed_mentions: unknown }[] = [];
    let calls = 0;
    const f = (async (_url: string, init: RequestInit) => {
      calls++;
      if (calls === 1) return new Response(JSON.stringify({ retry_after: 0 }), { status: 429 });
      bodies.push(JSON.parse(String(init.body)));
      return new Response(null, { status: 204 });
    }) as unknown as typeof fetch;
    await discordSink("https://discord.com/api/webhooks/1/x", f)(Array.from({ length: 30 }, (_, i) => `line ${i} ${"x".repeat(100)}`));
    expect(bodies.length).toBeGreaterThan(1);
    expect(bodies.every((b) => b.content.length <= 2_000)).toBe(true);
    expect(bodies[0]!.allowed_mentions).toEqual({ parse: [] });
    const failing = (async () => new Response(null, { status: 401 })) as unknown as typeof fetch;
    await expect(discordSink("https://discord.com/api/webhooks/1/x", failing)(["x"])).rejects.toThrow("401");
  });
});

describe("monitor reader", () => {
  const dirs: string[] = [];
  afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));
  it("does not replay history on start, then reports only new expiries and deferred refunds", () => {
    const dir = mkdtempSync(join(tmpdir(), "touchstone-monitor-"));
    dirs.push(dir);
    const path = join(dir, "index.sqlite");
    const store = new Store(path);
    const add = (block: bigint, name: string, recordId: bigint) =>
      store.addEvent({ chain: "c", txHash: `0x${block}`, logIndex: 0, blockNumber: block, contract: "0x9", name, args: { id: pool.toUpperCase().replace("0X", "0x"), recordId, refund: 4n, amount: 6n } });
    add(1n, "Expired", 1n);
    const reader = new MonitorReader(path, "c");
    expect(reader.newEvents()).toEqual({ expiries: [], deferred: [] });
    add(2n, "Expired", 2n);
    add(3n, "RefundDeferred", 3n);
    add(4n, "Settled", 4n);
    const ev = reader.newEvents();
    expect(ev.expiries).toEqual([{ poolId: pool, recordId: "2", refund: "4", tx: "0x2" }]);
    expect(ev.deferred).toEqual([{ poolId: pool, recordId: "3", amount: "6", tx: "0x3" }]);
    expect(reader.newEvents()).toEqual({ expiries: [], deferred: [] });
    expect(reader.p95Lag(pool, 100)).toEqual({ p95: 0, count: 0 });
    reader.close();
    store.close();
  });
});
