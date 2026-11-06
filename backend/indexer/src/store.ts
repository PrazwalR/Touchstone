import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import type { TouchstoneRecord } from "@touchstone/shared";

export interface RawEvent {
  chain: string;
  txHash: string;
  logIndex: number;
  blockNumber: bigint;
  contract: string;
  name: string;
  args: Record<string, unknown>;
}

const json = (v: unknown): string => JSON.stringify(v, (_k, x: unknown) => (typeof x === "bigint" ? x.toString() : x));

/** SQLite store for development; every statement is parameterised and every write idempotent. */
export class Store {
  readonly #db: DatabaseSync;

  constructor(path: string) {
    this.#db = new DatabaseSync(path);
    this.#db.exec(readFileSync(new URL("./schema.sql", import.meta.url), "utf8"));
  }

  /** Commits a range's events, derived rows and cursor together, or rolls them all back. */
  transaction<T>(write: () => T): T {
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      const result = write();
      this.#db.exec("COMMIT");
      return result;
    } catch (err) {
      this.#db.exec("ROLLBACK");
      throw err;
    }
  }

  /** Returns false if the event was already stored. */
  addEvent(e: RawEvent): boolean {
    const res = this.#db
      .prepare(
        "INSERT OR IGNORE INTO events (chain, tx_hash, log_index, block_number, contract, name, args_json) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .run(e.chain, e.txHash.toLowerCase(), e.logIndex, e.blockNumber, e.contract.toLowerCase(), e.name, json(e.args));
    return res.changes > 0;
  }

  openRecord(chain: string, block: bigint, r: TouchstoneRecord): void {
    this.#db
      .prepare(
        "INSERT OR IGNORE INTO records (chain, pool_id, record_id, opened_block, deposit, deposit_in0, beneficiary, status) VALUES (?, ?, ?, ?, ?, ?, ?, 'open')",
      )
      .run(chain, r.poolId.toLowerCase(), r.id.toString(), block, r.deposit.toString(), r.depositIn0 ? 1 : 0, r.beneficiary.toLowerCase());
  }

  closeRecord(chain: string, poolId: string, recordId: bigint, status: "settled" | "expired", block: bigint): void {
    this.#db
      .prepare("UPDATE records SET status = ?, closed_block = ? WHERE chain = ? AND pool_id = ? AND record_id = ? AND status = 'open'")
      .run(status, block, chain, poolId.toLowerCase(), recordId.toString());
  }

  markDeferred(chain: string, poolId: string, recordId: bigint): void {
    this.#db
      .prepare("UPDATE records SET refund_deferred = 1 WHERE chain = ? AND pool_id = ? AND record_id = ?")
      .run(chain, poolId.toLowerCase(), recordId.toString());
  }

  /** Removes everything at or above `block`, for a reorg deeper than the confirmation depth allowed. */
  rewind(chain: string, block: bigint): void {
    this.transaction(() => {
      this.#db.prepare("DELETE FROM blocks WHERE chain = ? AND block_number >= ?").run(chain, block);
      this.#db.prepare("DELETE FROM events WHERE chain = ? AND block_number >= ?").run(chain, block);
      this.#db.prepare("DELETE FROM records WHERE chain = ? AND opened_block >= ?").run(chain, block);
      this.#db.prepare("DELETE FROM pools WHERE chain = ? AND registered_block >= ?").run(chain, block);
      this.#db.prepare("DELETE FROM cursors WHERE chain = ?").run(chain);
      this.#db.prepare("UPDATE records SET status = 'open', closed_block = NULL, refund_deferred = 0 WHERE chain = ?").run(chain);
      // A deferred refund can survive independently of a later closure; replay retained evidence.
      const retained = this.#db.prepare(
        "SELECT name, args_json, block_number FROM events WHERE chain = ? AND name IN ('Settled', 'Expired', 'RefundDeferred') ORDER BY block_number, log_index",
      ).all(chain) as { name: string; args_json: string; block_number: number }[];
      for (const e of retained) {
        const a = JSON.parse(e.args_json) as { id: string; recordId: string };
        if (e.name === "RefundDeferred") this.markDeferred(chain, a.id, BigInt(a.recordId));
        else this.closeRecord(chain, a.id, BigInt(a.recordId), e.name === "Settled" ? "settled" : "expired", BigInt(e.block_number));
      }
    });
  }

  saveBlock(chain: string, blockNumber: bigint, hash: string, timestamp: bigint): void {
    this.#db.prepare("INSERT OR REPLACE INTO blocks (chain, block_number, block_hash, timestamp) VALUES (?, ?, ?, ?)")
      .run(chain, blockNumber, hash.toLowerCase(), timestamp);
  }

  countByStatus(chain: string): Record<string, number> {
    const rows = this.#db
      .prepare("SELECT status, COUNT(*) AS n FROM records WHERE chain = ? GROUP BY status")
      .all(chain) as { status: string; n: number }[];
    return Object.fromEntries(rows.map((r) => [r.status, Number(r.n)]));
  }

  addPool(chain: string, poolId: string, block: bigint): void {
    this.#db.prepare("INSERT OR IGNORE INTO pools (chain, pool_id, registered_block) VALUES (?, ?, ?)").run(chain, poolId.toLowerCase(), block);
  }

  pools(chain: string): string[] {
    const rows = this.#db.prepare("SELECT pool_id FROM pools WHERE chain = ? ORDER BY pool_id").all(chain) as { pool_id: string }[];
    return rows.map((r) => r.pool_id);
  }

  cursor(chain: string): { nextBlock: bigint; lastHash: string } | null {
    const row = this.#db.prepare("SELECT next_block, last_hash FROM cursors WHERE chain = ?").get(chain) as
      | { next_block: number; last_hash: string }
      | undefined;
    return row === undefined ? null : { nextBlock: BigInt(row.next_block), lastHash: row.last_hash };
  }

  setCursor(chain: string, nextBlock: bigint, lastHash: string): void {
    this.#db
      .prepare(
        "INSERT INTO cursors (chain, next_block, last_hash) VALUES (?, ?, ?) ON CONFLICT(chain) DO UPDATE SET next_block = excluded.next_block, last_hash = excluded.last_hash",
      )
      .run(chain, nextBlock, lastHash.toLowerCase());
  }

  countEvents(chain: string, name: string): number {
    const row = this.#db.prepare("SELECT COUNT(*) AS n FROM events WHERE chain = ? AND name = ?").get(chain, name) as { n: number };
    return Number(row.n);
  }

  close(): void {
    this.#db.close();
  }
}
