import { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { address, httpUrl, positiveInt } from "@touchstone/shared";

// The alerts of spec §15.6, evaluated from the indexer's database, the keeper's published metrics and the chain.
// Every threshold is configuration. evaluate() is pure; the I/O around it is thin.

const blank = (v: unknown) => (v === "" ? undefined : v);
const wei = z
  .string()
  .regex(/^(0|[1-9][0-9]*)$/)
  .transform(BigInt);

/** A Discord incoming-webhook URL; nothing else is accepted, so alerts cannot be pointed at an arbitrary host. */
export const discordWebhook = z
  .url()
  .refine((u) => {
    const url = new URL(u);
    return (
      url.protocol === "https:" &&
      /^((canary|ptb)\.)?discord(app)?\.com$/.test(url.hostname) &&
      /^\/api\/webhooks\/\d+\/[\w-]+$/.test(url.pathname)
    );
  }, "expected a Discord webhook URL");

export const monitorEnvSchema = z.object({
  MONITOR_RPC_URL: httpUrl,
  MONITOR_CHAIN_ID: positiveInt,
  MONITOR_DATABASE_PATH: z.string().min(1),
  MONITOR_INDEXER_CHAIN: z.string().regex(/^[a-z0-9-]+$/),
  MONITOR_KEEPER_METRICS_PATH: z.string().min(1),
  MONITOR_DISCORD_WEBHOOK_URL: discordWebhook,
  MONITOR_INTERVAL_MS: positiveInt,
  /** A firing alert is repeated at most this often. */
  MONITOR_COOLDOWN_S: positiveInt,
  /** Spec §15.6: p95 settlement lag above the pool's settle delay plus this. */
  MONITOR_LAG_SLACK_S: positiveInt,
  MONITOR_LAG_SAMPLE: positiveInt,
  /** Spec §15.6: Hermes errors above this share of requests, in basis points (100 = 1%). */
  MONITOR_HERMES_ERROR_BPS: z.coerce.number().int().min(1).max(10_000),
  /** Below this many requests in the keeper's window the error rate is not judged. */
  MONITOR_HERMES_MIN_REQUESTS: positiveInt,
  /** Warn this long before a lease runs out or a pending bid activates. */
  MONITOR_LEASE_WARN_S: positiveInt,
  /** Keeper metrics older than this mean the keeper is down or its ticks fail. */
  MONITOR_KEEPER_STALE_S: positiveInt,
  /** Floor for the keeper balance alert while the keeper has no day of spend to measure. */
  MONITOR_MIN_KEEPER_BALANCE_WEI: wei,
  TOUCHSTONE_FACTORY: address,
  TOUCHSTONE_LICENCE: z.preprocess(blank, address.optional()),
});
export type MonitorConfig = z.infer<typeof monitorEnvSchema>;

export interface Thresholds {
  lagSlackS: number;
  hermesErrorBps: number;
  hermesMinRequests: number;
  leaseWarnS: number;
  keeperStaleS: number;
  minKeeperBalanceWei: bigint;
}

export interface Observation {
  /** Wall clock, seconds: judges the keeper's freshness. */
  wallNow: number;
  /** Latest block time, seconds: judges leases. */
  chainNow: number;
  lag: { poolId: string; settleDelay: number; p95: number; count: number }[];
  expiries: { poolId: string; recordId: string; refund: string; tx: string }[];
  deferred: { poolId: string; recordId: string; amount: string; tx: string }[];
  keeper:
    | { updatedAt: number; balanceWei: bigint; spent24hWei: bigint; requests: number; errors: number; windowSeconds: number }
    | null;
  leases: { poolId: string; lapsesAt: number | null; activatesAt: number | null }[];
}

export interface Alert {
  key: string;
  text: string;
  /** Events are reported once; conditions are repeated after the cooldown and resolved when they clear. */
  once: boolean;
}

const short = (id: string) => `${id.slice(0, 10)}…`;

export function evaluate(o: Observation, t: Thresholds): Alert[] {
  const out: Alert[] = [];
  for (const l of o.lag) {
    if (l.count > 0 && l.p95 > l.settleDelay + t.lagSlackS)
      out.push({
        key: `lag:${l.poolId}`,
        once: false,
        text: `Settlement lag p95 is ${l.p95}s on pool ${short(l.poolId)}, above the ${l.settleDelay}s delay plus ${t.lagSlackS}s (${l.count} records). Check the keeper and Hermes.`,
      });
  }
  for (const e of o.expiries)
    out.push({
      key: `expiry:${e.poolId}:${e.recordId}`,
      once: true,
      text: `Record ${e.recordId} on pool ${short(e.poolId)} expired unsettled and refunded ${e.refund} base units; any value it would have retained for LPs is lost. tx ${e.tx}`,
    });
  for (const d of o.deferred)
    out.push({
      key: `deferred:${d.poolId}:${d.recordId}`,
      once: true,
      text: `Refund of record ${d.recordId} on pool ${short(d.poolId)} was deferred to the ledger (${d.amount} base units): the trader's address could not receive it directly. tx ${d.tx}`,
    });
  if (o.keeper === null) {
    out.push({ key: "keeper:missing", once: false, text: "No keeper metrics found. The keeper is not running, or KEEPER_METRICS_PATH points elsewhere." });
  } else {
    const k = o.keeper;
    const age = o.wallNow - k.updatedAt;
    if (age > t.keeperStaleS)
      out.push({ key: "keeper:stale", once: false, text: `Keeper metrics are ${age}s old: the keeper is down or every tick is failing. Anyone can still settle; records past their window will expire.` });
    const needed = k.spent24hWei > t.minKeeperBalanceWei ? k.spent24hWei : t.minKeeperBalanceWei;
    if (k.balanceWei < needed)
      out.push({ key: "keeper:balance", once: false, text: `Keeper balance ${k.balanceWei} wei is below a day of gas (${needed} wei). Fund the keeper account.` });
    if (k.requests >= t.hermesMinRequests && k.errors * 10_000 > t.hermesErrorBps * k.requests)
      out.push({
        key: "hermes:errors",
        once: false,
        text: `Hermes failed ${k.errors} of ${k.requests} requests in the last ${k.windowSeconds}s, above ${t.hermesErrorBps / 100}%. Check the API key and Hermes status.`,
      });
  }
  for (const l of o.leases) {
    if (l.lapsesAt !== null && l.lapsesAt - o.chainNow <= t.leaseWarnS)
      out.push({ key: `lease:lapse:${l.poolId}`, once: false, text: `The licence on pool ${short(l.poolId)} runs out in ${l.lapsesAt - o.chainNow}s unless topped up; the pool then falls back to the plain clawback.` });
    if (l.activatesAt !== null && l.activatesAt - o.chainNow <= t.leaseWarnS)
      out.push({ key: `lease:bid:${l.poolId}:${l.activatesAt}`, once: true, text: `A pending bid on pool ${short(l.poolId)} activates in ${Math.max(0, l.activatesAt - o.chainNow)}s and takes the licence.` });
  }
  return out;
}

export type Sink = (lines: string[]) => Promise<void>;

/** Sends new alerts, repeats firing conditions after the cooldown, and reports conditions that cleared. */
export class Alerter {
  readonly #sink: Sink;
  readonly #cooldownS: number;
  readonly #firing = new Map<string, number>();
  readonly #sentOnce = new Set<string>();

  constructor(sink: Sink, cooldownS: number) {
    this.#sink = sink;
    this.#cooldownS = cooldownS;
  }

  async report(alerts: Alert[], now: number): Promise<number> {
    const lines: string[] = [];
    const active = new Set<string>();
    for (const a of alerts) {
      if (a.once) {
        if (this.#sentOnce.has(a.key)) continue;
        this.#sentOnce.add(a.key);
        lines.push(`ALERT ${a.text}`);
        continue;
      }
      active.add(a.key);
      const last = this.#firing.get(a.key);
      if (last === undefined || now - last >= this.#cooldownS) {
        this.#firing.set(a.key, now);
        lines.push(`${last === undefined ? "ALERT" : "STILL FIRING"} ${a.text}`);
      }
    }
    for (const key of [...this.#firing.keys()])
      if (!active.has(key)) {
        this.#firing.delete(key);
        lines.push(`RESOLVED ${key}`);
      }
    if (lines.length) await this.#sink(lines);
    return lines.length;
  }
}

const DISCORD_LIMIT = 1_900;

/** Posts to a Discord webhook in messages under Discord's 2,000-character limit, with mentions disabled. */
export function discordSink(url: string, fetchImpl: typeof fetch = fetch, label = "Touchstone testnet"): Sink {
  return async (lines) => {
    const chunks: string[] = [];
    let current = `**${label}**`;
    for (const line of lines) {
      const next = `${current}\n${line.slice(0, DISCORD_LIMIT - label.length - 8)}`;
      if (next.length > DISCORD_LIMIT) {
        chunks.push(current);
        current = `**${label}**\n${line.slice(0, DISCORD_LIMIT - label.length - 8)}`;
      } else current = next;
    }
    chunks.push(current);
    for (const content of chunks) {
      for (let attempt = 0; attempt < 2; attempt++) {
        const res = await fetchImpl(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ content, allowed_mentions: { parse: [] } }),
          signal: AbortSignal.timeout(10_000),
        });
        if (res.ok) break;
        if (res.status === 429 && attempt === 0) {
          const body = z.object({ retry_after: z.number().nonnegative().max(60) }).safeParse(await res.json().catch(() => null));
          await new Promise((r) => setTimeout(r, Math.ceil((body.success ? body.data.retry_after : 1) * 1000)));
          continue;
        }
        throw new Error(`Discord webhook returned ${res.status}`);
      }
    }
  };
}

const lagRow = z.object({ lag: z.number().int().nonnegative() });
const eventRow = z.object({ block_number: z.number().int(), log_index: z.number().int(), tx_hash: z.string(), args_json: z.string() });
const cursorRow = z.object({ block_number: z.number().int().nullable(), log_index: z.number().int().nullable() });
const idArgs = z.object({ id: z.string(), recordId: z.union([z.string(), z.number()]) }).passthrough();

/** Read-only view of the indexer's database for the monitor. */
export class MonitorReader {
  readonly #db: DatabaseSync;
  readonly #chain: string;
  #cursor: { block: number; logIndex: number } | null = null;

  constructor(path: string, chain: string) {
    this.#db = new DatabaseSync(path, { readOnly: true });
    this.#chain = chain;
  }

  pools(): string[] {
    return this.#db
      .prepare("SELECT pool_id FROM pools WHERE chain = ? ORDER BY pool_id")
      .all(this.#chain)
      .map((r) => z.object({ pool_id: z.string() }).parse(r).pool_id);
  }

  /** Swap-to-settlement lag of the pool's latest settled records, measured as the history API measures it. */
  p95Lag(poolId: string, sample: number): { p95: number; count: number } {
    const lags = this.#db
      .prepare(
        `SELECT b.timestamp - CAST(json_extract(e.args_json, '$.record.timestamp') AS INTEGER) AS lag
      FROM records r JOIN events e ON e.chain = r.chain AND e.name = 'DepositTaken'
        AND lower(json_extract(e.args_json, '$.id')) = r.pool_id
        AND CAST(json_extract(e.args_json, '$.recordId') AS TEXT) = r.record_id
      JOIN blocks b ON b.chain = r.chain AND b.block_number = r.closed_block
      WHERE r.chain = ? AND r.pool_id = ? AND r.status = 'settled' ORDER BY r.closed_block DESC LIMIT ?`,
      )
      .all(this.#chain, poolId, sample)
      .map((r) => lagRow.parse(r).lag)
      .sort((a, b) => a - b);
    if (lags.length === 0) return { p95: 0, count: 0 };
    return { p95: lags[Math.max(0, Math.ceil(lags.length * 0.95) - 1)]!, count: lags.length };
  }

  /**
   * Expired and RefundDeferred events indexed since the last call. The first call only sets the cursor, so a
   * restarted monitor does not replay history into the channel.
   */
  newEvents(): { expiries: Observation["expiries"]; deferred: Observation["deferred"] } {
    const out = { expiries: [] as Observation["expiries"], deferred: [] as Observation["deferred"] };
    if (this.#cursor === null) {
      const top = cursorRow.parse(
        this.#db
          .prepare(
            "SELECT block_number, log_index FROM events WHERE chain = ? ORDER BY block_number DESC, log_index DESC LIMIT 1",
          )
          .get(this.#chain) ?? { block_number: null, log_index: null },
      );
      this.#cursor = { block: top.block_number ?? -1, logIndex: top.log_index ?? -1 };
      return out;
    }
    const rows = this.#db
      .prepare(
        `SELECT block_number, log_index, tx_hash, name, args_json FROM events
      WHERE chain = ? AND name IN ('Expired', 'RefundDeferred')
        AND (block_number > ? OR (block_number = ? AND log_index > ?))
      ORDER BY block_number, log_index`,
      )
      .all(this.#chain, this.#cursor.block, this.#cursor.block, this.#cursor.logIndex);
    for (const raw of rows) {
      const r = eventRow.extend({ name: z.enum(["Expired", "RefundDeferred"]) }).parse(raw);
      const args = idArgs.parse(JSON.parse(r.args_json));
      const base = { poolId: args.id.toLowerCase(), recordId: String(args.recordId), tx: r.tx_hash };
      if (r.name === "Expired") out.expiries.push({ ...base, refund: String(args.refund ?? "0") });
      else out.deferred.push({ ...base, amount: String(args.amount ?? "0") });
      this.#cursor = { block: r.block_number, logIndex: r.log_index };
    }
    return out;
  }

  close(): void {
    this.#db.close();
  }
}
