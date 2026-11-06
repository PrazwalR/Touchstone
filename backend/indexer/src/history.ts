import { DatabaseSync } from "node:sqlite";
import { z } from "zod";

const value: z.ZodType<unknown> = z.lazy(() =>
  z.union([
    z.string(),
    z.number().finite(),
    z.boolean(),
    z.null(),
    z.array(value),
    z.record(z.string(), value),
  ]),
);
const LAG_SAMPLE_LIMIT = 1000;
const rowSchema = z.strictObject({
  tx_hash: z.string(),
  log_index: z.number().int(),
  block_number: z.number().int().safe(),
  name: z.string(),
  args_json: z.string(),
});
export type HistoryKind = "records" | "ledger" | "licence";
/** Auction and hook events of the licence (spec §10). */
export const LICENCE_EVENTS = [
  "BidPlaced",
  "LeaseActivated",
  "LeaseLapsed",
  "RentCharged",
  "RentCredited",
  "SwapperSet",
  "DepositChanged",
  "LicensedSwap",
  "RefundCredited",
  "RefundClaimed",
] as const;
const amount = z.string().regex(/^(0|[1-9][0-9]*)$/).transform(BigInt);

export interface HistoryQuery {
  poolId?: string | undefined;
  recordId?: string | undefined;
  recipient?: string | undefined;
  owner?: string | undefined;
  limit: number;
  offset: number;
}

/** Independent connection cannot mutate the indexer's database or create a missing database. */
export class History {
  readonly #db: DatabaseSync;
  readonly #chain: string;
  constructor(path: string, chain: string) {
    this.#db = new DatabaseSync(path, { readOnly: true });
    this.#chain = chain;
  }

  /** Query parameters are bound values; no caller-controlled SQL fragments. */
  events(kind: HistoryKind, q: HistoryQuery): object[] {
    const rows = this.#db
      .prepare(
        `SELECT tx_hash, log_index, block_number, name, args_json FROM events
      WHERE chain = ? AND
      ((? = 'records' AND name IN ('DepositTaken','Settled','Expired','RefundDeferred')) OR
       (? = 'ledger' AND name IN ('Credited','Claimed')) OR
       (? = 'licence' AND name IN (${LICENCE_EVENTS.map((n) => `'${n}'`).join(",")})))
      AND (? IS NULL OR lower(json_extract(args_json, '$.id')) = ?)
      AND (? IS NULL OR CAST(json_extract(args_json, '$.recordId') AS TEXT) = ?)
      AND (? IS NULL OR lower(json_extract(args_json, '$.recipient')) = ?)
      AND (? IS NULL OR lower(json_extract(args_json, '$.owner')) = ?)
      ORDER BY block_number DESC, log_index DESC LIMIT ? OFFSET ?`,
      )
      .all(
        this.#chain,
        kind,
        kind,
        kind,
        q.poolId ?? null,
        q.poolId ?? null,
        q.recordId ?? null,
        q.recordId ?? null,
        q.recipient ?? null,
        q.recipient ?? null,
        q.owner ?? null,
        q.owner ?? null,
        q.limit,
        q.offset,
      );
    return rows.map((raw) => {
      const r = rowSchema.parse(raw);
      return {
        tx: r.tx_hash,
        logIndex: r.log_index,
        block: r.block_number.toString(),
        name: r.name,
        args: z.record(z.string(), value).parse(JSON.parse(r.args_json)),
      };
    });
  }

  /**
   * Totals of one pool's licence events. Amounts are summed exactly as integers, never in SQL, whose integers
   * overflow on uint256. The live holder is not derived here: a lease lapses without an event until the next
   * accrual, so readers take it from the auction's holderOf.
   */
  licenceSummary(poolId: string): object {
    const totals = {
      rentCharged: 0n,
      rentCredited: 0n,
      toRebatePool: 0n,
      toVesting: 0n,
    };
    const counts: Record<string, number> = Object.fromEntries(
      LICENCE_EVENTS.map((n) => [n, 0]),
    );
    let lastActivation: object | null = null;
    let lastLapse: object | null = null;
    const rows = this.#db
      .prepare(
        `SELECT tx_hash, log_index, block_number, name, args_json FROM events
      WHERE chain = ? AND lower(json_extract(args_json, '$.id')) = ?
        AND name IN (${LICENCE_EVENTS.map((n) => `'${n}'`).join(",")})
      ORDER BY block_number, log_index`,
      )
      .iterate(this.#chain, poolId);
    for (const raw of rows) {
      const r = rowSchema.parse(raw);
      const args = z.record(z.string(), value).parse(JSON.parse(r.args_json));
      counts[r.name] = (counts[r.name] ?? 0) + 1;
      if (r.name === "RentCharged") totals.rentCharged += amount.parse(args.amount);
      if (r.name === "RentCredited") {
        totals.rentCredited += amount.parse(args.amount);
        totals.toRebatePool += amount.parse(args.toRebatePool);
        totals.toVesting += amount.parse(args.toVesting);
      }
      const at = { tx: r.tx_hash, block: r.block_number.toString(), args };
      if (r.name === "LeaseActivated") lastActivation = at;
      if (r.name === "LeaseLapsed") lastLapse = at;
    }
    return {
      chain: this.#chain,
      poolId,
      label: "measured indexed events",
      counts,
      rentCharged: totals.rentCharged.toString(),
      rentCredited: totals.rentCredited.toString(),
      toRebatePool: totals.toRebatePool.toString(),
      toVesting: totals.toVesting.toString(),
      // I12: the hook credits what the auction charged. A gap means an accrual is still in flight or the
      // index is behind; it is reported, never hidden.
      rentInFlight: (totals.rentCharged - totals.rentCredited).toString(),
      lastActivation,
      lastLapse,
    };
  }

  health(): object {
    const counts = this.#db
      .prepare(
        "SELECT status, COUNT(*) AS count FROM records WHERE chain = ? GROUP BY status",
      )
      .all(this.#chain);
    const deferred = this.#db
      .prepare(
        "SELECT COUNT(*) AS count FROM records WHERE chain = ? AND refund_deferred = 1",
      )
      .get(this.#chain);
    const cursor = this.#db
      .prepare(
        "SELECT CAST(next_block AS TEXT) AS nextBlock, last_hash AS lastHash FROM cursors WHERE chain = ?",
      )
      .get(this.#chain);
    const rows = this.#db
      .prepare(
        `SELECT b.timestamp - CAST(json_extract(e.args_json, '$.record.timestamp') AS INTEGER) AS lag
      FROM records r JOIN events e ON e.chain = r.chain AND e.name = 'DepositTaken'
        AND lower(json_extract(e.args_json, '$.id')) = r.pool_id
        AND CAST(json_extract(e.args_json, '$.recordId') AS TEXT) = r.record_id
      JOIN blocks b ON b.chain = r.chain AND b.block_number = r.closed_block
      WHERE r.chain = ? AND r.status = 'settled' ORDER BY r.closed_block DESC LIMIT ?`,
      )
      .all(this.#chain, LAG_SAMPLE_LIMIT);
    const lags = rows
      .map(
        (r) => z.object({ lag: z.number().int().nonnegative() }).parse(r).lag,
      )
      .sort((a, b) => a - b);
    const percentile = (fraction: number): number =>
      lags[Math.max(0, Math.ceil(lags.length * fraction) - 1)]!;
    return {
      chain: this.#chain,
      counts,
      deferred,
      cursor: cursor ?? null,
      settlementLagSeconds: lags.length
        ? {
            count: lags.length,
            median:
              (lags[Math.floor((lags.length - 1) / 2)]! +
                lags[Math.floor(lags.length / 2)]!) /
              2,
            p95: percentile(0.95),
            sampleLimit: LAG_SAMPLE_LIMIT,
          }
        : null,
      lpNetEstimate: null,
      unavailable: [
        "Lag covers records with both deposit evidence and indexed closure-block timestamps; older databases need a configured-history rescan.",
        "LP net requires an independently sourced 15-second markout tape; no estimate is fabricated.",
      ],
    };
  }
  close(): void {
    this.#db.close();
  }
}
