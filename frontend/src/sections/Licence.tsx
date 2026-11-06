import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import { Fragment, useEffect, useState } from "react";
import { HISTORY_URL, POLL_MS } from "../config.ts";
import {
  deployment,
  explorerAddress,
  explorerTx,
  pool,
} from "../chain/deployment.ts";
import {
  licencePageSchema,
  licenceSummarySchema,
  readHistory,
  type LicenceEvent,
  type LicenceSummary,
} from "../chain/history.ts";
import { licenceTimeline, rentPerHour } from "../chain/licence.ts";
import { readLicence, type LicenceState } from "../chain/reads.ts";
import { errorMessage } from "../chain/useLive.ts";
import { int, shortAddr, units, utc } from "../format.ts";

const Q = deployment.tokens.quote;
const EVENT_ROWS = 12;
const dash = "—";

function KV({ rows }: { rows: [string, string][] }) {
  return (
    <div className="kv">
      {rows.map(([k, v]) => (
        <Fragment key={k}>
          <div>{k}</div>
          <div className="v">{v}</div>
        </Fragment>
      ))}
    </div>
  );
}

const quote = (v: bigint, places = 4) =>
  `${units(v, Q.decimals, places)} ${Q.symbol}`;

/** The arbitrage licence (spec §10): who holds it, until when, and what its rent has paid LPs. Read-only. */
export function Licence() {
  const [state, setState] = useState<LicenceState | null | undefined>(
    undefined,
  );
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<LicenceSummary | null>(null);
  const [events, setEvents] = useState<LicenceEvent[]>([]);
  const [historyError, setHistoryError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const run = async () => {
      try {
        const s = await readLicence();
        if (controller.signal.aborted) return;
        setState(s);
        setError(null);
        if (s !== null && HISTORY_URL) {
          try {
            const [sum, page] = await Promise.all([
              readHistory(
                HISTORY_URL,
                `licence/summary?poolId=${pool.poolId.toLowerCase()}`,
                deployment.chain,
                controller.signal,
              ),
              readHistory(
                HISTORY_URL,
                `licence?poolId=${pool.poolId.toLowerCase()}&limit=${EVENT_ROWS}`,
                deployment.chain,
                controller.signal,
              ),
            ]);
            if (!controller.signal.aborted) {
              setSummary(licenceSummarySchema.parse(sum));
              setEvents(licencePageSchema.parse(page).items);
              setHistoryError(null);
            }
          } catch {
            if (!controller.signal.aborted)
              setHistoryError(
                "Indexed licence history unavailable or invalid.",
              );
          }
        }
      } catch (e) {
        if (!controller.signal.aborted) setError(errorMessage(e));
      }
      if (!controller.signal.aborted)
        timer = setTimeout(() => void run(), POLL_MS);
    };
    void run();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, []);

  if (state === null) {
    return (
      <div className="live-block" id="licence">
        <h3 className="data-title">Arbitrage licence · {deployment.name}</h3>
        <p className="empty">
          This deployment has no licence auction for its pool. The licence is
          built (milestone M9) and arrives on this testnet with the next
          deployment.
        </p>
      </div>
    );
  }

  const t = state ? licenceTimeline(state.top, state.next, state.k) : null;
  return (
    <div className="live-block" id="licence">
      <h3 className="data-title">
        Arbitrage licence · {deployment.name} · testnet demonstration
      </h3>
      {error && (
        <p role="alert" className="err">
          Licence read failed: {error}
        </p>
      )}
      {state === undefined && !error && (
        <p className="tl">Reading the auction…</p>
      )}
      {state && t && (
        <div className="live-grid">
          <div className="live-col">
            <h3 className="h3">
              {state.live ? "Licence held" : "No live licence"}
            </h3>
            <KV
              rows={[
                ["Exempt address", state.live ? shortAddr(state.holder) : dash],
                ["Owner", state.live ? shortAddr(state.top.owner) : dash],
                [
                  "Rent",
                  state.live
                    ? `${quote(rentPerHour(state.top.rent), 2)} per hour`
                    : dash,
                ],
                [
                  "Deposit left",
                  state.live ? quote(state.top.deposit, 2) : dash,
                ],
                ["Runs out at", t.lapsesAt === null ? dash : utc(t.lapsesAt)],
              ]}
            />
            <p className="src">
              LicenceAuction.holderOf() · leases() at block{" "}
              {int(state.blockNumber)}. While live, the holder's first large
              swap per block, inside the band, posts no deposit; every other
              swap is clawed back as usual.
            </p>
          </div>
          <div className="live-col">
            <h3 className="h3">
              {t.activatesAt === null ? "No pending bid" : "Bid pending"}
            </h3>
            <KV
              rows={[
                [
                  "Pending rent",
                  t.activatesAt === null
                    ? dash
                    : `${quote(rentPerHour(state.next.rent), 2)} per hour`,
                ],
                [
                  "Activates at",
                  t.activatesAt === null
                    ? dash
                    : `${utc(t.activatesAt)}${t.displaces ? " · displaces the holder" : ""}`,
                ],
                [
                  "Lowest next bid",
                  `${quote(rentPerHour(state.minNextRent), 2)} per hour`,
                ],
                [
                  "Notice",
                  `${int(state.k)} s · outbid by ${state.minIncrementBps / 100}%`,
                ],
                [
                  "Auction",
                  deployment.contracts.licenceAuction
                    ? shortAddr(deployment.contracts.licenceAuction)
                    : dash,
                ],
              ]}
            />
            <p className="src">
              minNextRent() · terms(). A displaced holder or bid gets its unused
              deposit back through claimRefund.
              {deployment.contracts.licenceAuction && (
                <>
                  {" "}
                  <a
                    href={explorerAddress(deployment.contracts.licenceAuction)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Contract
                  </a>
                </>
              )}
            </p>
          </div>
          <div className="live-col">
            <h3 className="h3">
              {summary ? quote(BigInt(summary.rentCredited), 2) : dash}
            </h3>
            {!HISTORY_URL ? (
              <p className="empty">
                Rent totals need the read-only indexer API, which is not
                configured.
              </p>
            ) : (
              <KV
                rows={[
                  [
                    "Charged by the auction",
                    summary ? quote(BigInt(summary.rentCharged)) : dash,
                  ],
                  [
                    "Credited by the hook",
                    summary ? quote(BigInt(summary.rentCredited)) : dash,
                  ],
                  [
                    "Not yet delivered",
                    summary ? quote(BigInt(summary.rentInFlight)) : dash,
                  ],
                  [
                    "To the rebate pool",
                    summary ? quote(BigInt(summary.toRebatePool)) : dash,
                  ],
                  [
                    "Licensed swaps",
                    summary ? int(summary.counts.LicensedSwap ?? 0) : dash,
                  ],
                ]}
              />
            )}
            <p className="src">
              RentCharged and RentCredited events, summed exactly. Charged
              equals credited once every accrual has landed (invariant I12).
              Testnet rent says nothing about LP returns.
            </p>
          </div>
        </div>
      )}
      {historyError && <p className="err">{historyError}</p>}
      {state && events.length > 0 && (
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
              {events.map((e) => (
                <TableRow key={`${e.tx}-${e.logIndex}`}>
                  <TableCell>{e.name}</TableCell>
                  <TableCell>{e.block}</TableCell>
                  <TableCell>
                    <a href={explorerTx(e.tx)} target="_blank" rel="noreferrer">
                      {shortAddr(e.tx)}
                    </a>
                    <details>
                      <summary>Event fields</summary>
                      <p className="tl">
                        Amounts are integer {Q.symbol} base units; rent is per
                        second.
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
      )}
    </div>
  );
}
