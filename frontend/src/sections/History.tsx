import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import { useEffect, useState } from "react";
import { HISTORY_URL, POLL_MS } from "../config.ts";
import { deployment, explorerTx, pool } from "../chain/deployment.ts";
import {
  healthSchema,
  pageSchema,
  readHistory,
  type HistoryEvent,
  type HistoryHealth,
} from "../chain/history.ts";
import { shortAddr } from "../format.ts";

const PAGE_SIZE = 20;
const CHAIN = deployment.chain;

/** Historical evidence is separate from the latest-block state panel. */
export function History() {
  const [kind, setKind] = useState<"records" | "ledger">("records");
  const [filter, setFilter] = useState(
    () => new URLSearchParams(window.location.search).get("record") ?? "",
  );
  const [offset, setOffset] = useState(0);
  const [items, setItems] = useState<HistoryEvent[]>([]);
  const [health, setHealth] = useState<HistoryHealth | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [readAt, setReadAt] = useState<string | null>(null);
  const valid =
    filter === "" ||
    (kind === "records"
      ? /^\d+$/.test(filter) && BigInt(filter) < 2n ** 64n
      : /^0x[0-9a-fA-F]{40}$/.test(filter));
  useEffect(() => {
    if (!HISTORY_URL || !valid) {
      setItems([]);
      setReadAt(null);
      setLoading(false);
      setError(null);
      return;
    }
    const base = HISTORY_URL;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const run = async () => {
      setLoading(true);
      const query = new URLSearchParams({
        limit: String(PAGE_SIZE),
        offset: String(offset),
      });
      if (kind === "records") query.set("poolId", pool.poolId);
      if (filter)
        query.set(kind === "records" ? "recordId" : "recipient", filter);
      try {
        const [events, stats] = await Promise.all([
          readHistory(base, `${kind}?${query}`, CHAIN, controller.signal),
          readHistory(base, "health", CHAIN, controller.signal),
        ]);
        if (!controller.signal.aborted) {
          setItems(pageSchema.parse(events).items);
          setHealth(healthSchema.parse(stats));
          setError(null);
          setReadAt(new Date().toISOString());
        }
      } catch {
        if (!controller.signal.aborted)
          setError(
            "Indexed history unavailable or invalid. Previously read evidence may be stale.",
          );
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
          timer = setTimeout(() => void run(), POLL_MS);
        }
      }
    };
    setItems([]);
    setReadAt(null);
    void run();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [kind, offset, filter, valid]);
  return (
    <div className="live-block" id="history">
      <h3 className="data-title">
        Indexed history · {deployment.name} · testnet demonstration
      </h3>
      {!HISTORY_URL ? (
        <p className="empty">
          Indexed history is not configured. Record details, ledger credits and
          keeper history require the read-only indexer API.
        </p>
      ) : (
        <>
          <div className="seg">
            {(["records", "ledger"] as const).map((v) => (
              <Button
                key={v}
                className={`opt ${kind === v ? "on" : ""}`}
                onClick={() => {
                  setKind(v);
                  setOffset(0);
                  setFilter("");
                }}
              >
                {v === "records" ? "Record explorer" : "Credits and claims"}
              </Button>
            ))}
          </div>
          <label className="field">
            {kind === "records"
              ? "Record id (optional)"
              : "Recipient address (optional)"}
            <Input
              value={filter}
              onChange={(e) => {
                setFilter(e.target.value);
                setOffset(0);
              }}
              aria-invalid={!valid}
            />
          </label>
          {!valid && (
            <p className="err">
              Enter a valid{" "}
              {kind === "records" ? "uint64 record id" : "20-byte address"}.
            </p>
          )}
          {error && (
            <p role="alert" className="err">
              {error}
            </p>
          )}
          <p className="tl">
            {loading
              ? "Reading indexed events…"
              : readAt
                ? `Last read ${readAt}`
                : "Not read"}
          </p>
          <div className="tablewrap">
            <Table className="table">
              <TableHeader>
                <TableRow>
                  <TableHead>Event</TableHead>
                  <TableHead>Block</TableHead>
                  <TableHead>Evidence</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((e) => (
                  <TableRow key={`${e.tx}-${e.logIndex}`}>
                    <TableCell>{e.name}</TableCell>
                    <TableCell>{e.block}</TableCell>
                    <TableCell>
                      <a
                        href={explorerTx(e.tx)}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {shortAddr(e.tx)}
                      </a>
                      <details>
                        <summary>Record and payout fields</summary>
                        {typeof e.args.recordId === "string" &&
                          /^\d+$/.test(e.args.recordId) && (
                            <a href={`?record=${e.args.recordId}#history`}>
                              All evidence for record #{e.args.recordId}
                            </a>
                          )}
                        <p className="tl">
                          Token amounts are integer base units in the deposit
                          currency. fairPriceX36 is the quote-per-risky
                          base-unit ratio scaled by 10³⁶; alphaBps is in basis
                          points.
                        </p>
                        <pre className="history-evidence">
                          {JSON.stringify(e.args, null, 2)}
                        </pre>
                      </details>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {valid && !loading && !error && items.length === 0 && (
            <p className="empty">No indexed events match this page.</p>
          )}
          <Button
            variant="outline"
            size="sm"
            disabled={loading || offset === 0}
            onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
          >
            Previous
          </Button>{" "}
          <Button
            variant="outline"
            size="sm"
            disabled={
              loading ||
              items.length < PAGE_SIZE ||
              offset >= 1_000_000 - PAGE_SIZE
            }
            onClick={() => setOffset(offset + PAGE_SIZE)}
          >
            Next
          </Button>
          {health && (
            <div className="live-block">
              <h3 className="data-title">Keeper evidence · indexed history</h3>
              <p>
                {health.counts
                  .map((c) => `${c.status}: ${c.count}`)
                  .join(" · ") || "No records indexed"}{" "}
                · deferred refunds: {health.deferred.count}
              </p>
              <p>
                Settlement lag from swap:{" "}
                {health.settlementLagSeconds
                  ? `median ${health.settlementLagSeconds.median}s · p95 ${health.settlementLagSeconds.p95}s · ${health.settlementLagSeconds.count} measured records (latest ${health.settlementLagSeconds.sampleLimit} maximum)`
                  : "not available"}
              </p>
              <p className="tl">
                Next indexer block: {health.cursor?.nextBlock ?? "not indexed"}.
                This is indexer evidence, not a keeper heartbeat.
              </p>
              {health.unavailable.map((s) => (
                <p className="src" key={s}>
                  {s}
                </p>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
