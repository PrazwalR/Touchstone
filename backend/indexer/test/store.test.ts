import { describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/store.ts";
import type { TouchstoneRecord } from "@touchstone/shared";

const record = {
  poolId: "0xAA",
  id: 7n,
  deposit: 1_500_000_000n,
  depositIn0: true,
  beneficiary: "0xBB",
} as unknown as TouchstoneRecord;

describe("Store", () => {
  it("writes each event once", () => {
    const s = new Store(":memory:");
    const e = { chain: "c", txHash: "0x1", logIndex: 0, blockNumber: 10n, contract: "0xH", name: "DepositTaken", args: { x: 1n } };
    expect(s.addEvent(e)).toBe(true);
    expect(s.addEvent({ ...e, txHash: "0X1" })).toBe(false);
    s.close();
  });

  it("tracks a record from open to settled and back on rewind", () => {
    const s = new Store(":memory:");
    s.openRecord("c", 10n, record);
    s.openRecord("c", 10n, record);
    expect(s.countByStatus("c")).toEqual({ open: 1 });
    s.closeRecord("c", "0xaa", 7n, "settled", 12n);
    expect(s.countByStatus("c")).toEqual({ settled: 1 });
    s.rewind("c", 12n);
    expect(s.countByStatus("c")).toEqual({ open: 1 });
    s.rewind("c", 10n);
    expect(s.countByStatus("c")).toEqual({});
    s.close();
  });

  it("keeps a cursor per chain, with the hash of the last indexed block", () => {
    const s = new Store(":memory:");
    expect(s.cursor("c")).toBeNull();
    s.setCursor("c", 42n, "0xAA");
    s.setCursor("c", 43n, "0xBB");
    expect(s.cursor("c")).toEqual({ nextBlock: 43n, lastHash: "0xbb" });
    s.close();
  });

  it("rewinds pools registered at or after the rewind block", () => {
    const s = new Store(":memory:");
    s.addPool("c", "0xP1", 5n);
    s.addPool("c", "0xP2", 9n);
    s.rewind("c", 8n);
    expect(s.pools("c")).toEqual(["0xp1"]);
    s.close();
  });
});


describe("Store rewind integrity", () => {
  it("rebuilds deferred flags from retained events and invalidates the cursor", () => {
    const dir = mkdtempSync(join(tmpdir(), "touchstone-indexer-"));
    const path = join(dir, "store.sqlite");
    const s = new Store(path);
    const db = new DatabaseSync(path);
    try {
      s.openRecord("c", 5n, record);
      s.openRecord("c", 5n, { ...record, id: 8n });
      s.openRecord("c", 5n, { ...record, id: 9n });
      s.addEvent({ chain: "c", txHash: "0x9", logIndex: 0, blockNumber: 7n, contract: "0xS", name: "Expired", args: { id: record.poolId, recordId: 9n } });
      s.closeRecord("c", record.poolId, 9n, "expired", 7n);
      for (const [id, block] of [[7n, 6n], [8n, 9n]] as const) {
        s.addEvent({ chain: "c", txHash: `0x${id}`, logIndex: 0, blockNumber: block, contract: "0xH", name: "RefundDeferred", args: { id: record.poolId, recordId: id } });
        s.markDeferred("c", record.poolId, id);
        s.closeRecord("c", record.poolId, id, "settled", 9n);
      }
      s.setCursor("c", 10n, "0xaa");
      s.rewind("c", 8n);
      const rows = db.prepare("SELECT record_id, refund_deferred, status FROM records ORDER BY record_id").all();
      expect(rows).toEqual([
        { record_id: "7", refund_deferred: 1, status: "open" },
        { record_id: "8", refund_deferred: 0, status: "open" },
        { record_id: "9", refund_deferred: 0, status: "expired" },
      ]);
      expect(s.cursor("c")).toBeNull();
    } finally { db.close(); s.close(); rmSync(dir, { recursive: true }); }
  });
});
