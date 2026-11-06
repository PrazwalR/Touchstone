import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
// Live testnet panels, shared by the Swap and Simulation views: the network line, the pool and hook state, the
// record history read over RPC, and the deployed contracts.
import { Fragment } from "react";
import {
  deployment,
  explorerAddress,
  explorerTx,
  pool,
} from "../chain/deployment.ts";
import { priceQuotePerRiskyE6, type RecordEvent } from "../chain/reads.ts";
import type { Live } from "../chain/useLive.ts";
import { ago, int, shortAddr, units, usd, utc } from "../format.ts";
import { EVENT_ROWS, POLL_MS } from "../config.ts";

const Q = deployment.tokens.quote;
const RISKY = deployment.tokens.risky;

function KV({ rows }: { rows: [string, string, string?][] }) {
  return (
    <div className="kv">
      {rows.map(([k, v, cls]) => (
        <Fragment key={k}>
          <div>{k}</div>
          <div className={`v ${cls ?? ""}`}>{v}</div>
        </Fragment>
      ))}
    </div>
  );
}

export function NetLine({ live, now }: { live: Live; now: number }) {
  const s = live.snapshot;
  const stale = live.readAt !== null && now - live.readAt > POLL_MS * 3;
  const cls =
    live.error && !s
      ? "error"
      : stale || live.error
        ? "stale"
        : s
          ? "fresh"
          : "";
  return (
    <div className="netline">
      <Badge variant="outline" className="chip chip-impl">
        Deployed · verified on Arbiscan
      </Badge>
      <Badge variant="outline" className="chip chip-illu">
        Testnet · says nothing about LP returns
      </Badge>
      <p className="tl">
        <span className={`state-dot ${cls}`} aria-hidden="true" />
        {s
          ? `${deployment.name} · chain ${deployment.chainId} · block ${int(s.blockNumber)} · read ${live.readAt ? ago(now - live.readAt) : ""}`
          : live.error
            ? `Not read · ${live.error}`
            : `Reading ${deployment.name}…`}
        {s && live.error ? ` · last read failed: ${live.error}` : ""}
      </p>
    </div>
  );
}

function bps(n: number): string {
  return `${n} bps`;
}

export function Columns({ live }: { live: Live }) {
  const s = live.snapshot;
  const dash = "—";
  const st = s?.state;
  const c = s?.config;
  const price = s ? priceQuotePerRiskyE6(s.sqrtPriceX96) : null;
  return (
    <div className="live-grid">
      <div className="live-col">
        <h3 className="h3">{pool.label}</h3>
        <KV
          rows={[
            [
              "Pool price",
              price === null
                ? dash
                : `${units(price, 6, 2)} ${Q.symbol} per ${RISKY.symbol}`,
              "em",
            ],
            ["Tick", s ? int(s.tick) : dash],
            ["In-range liquidity", s ? int(s.liquidity) : dash],
            [
              "LP fee",
              `${pool.fee / 100} bps · tick spacing ${pool.tickSpacing}`,
            ],
            ["Pool id", shortAddr(pool.poolId)],
          ]}
        />
        <p className="src">
          StateView.getSlot0() · getLiquidity(). A testnet pool; its price is
          whatever the last swap left, not a market price.
        </p>
      </div>
      <div className="live-col">
        <h3 className="h3">Records and balances</h3>
        <KV
          rows={[
            ["Records opened", st ? int(st.nextRecordId) : dash, "em"],
            [
              "Outstanding deposits",
              st
                ? `${units(st.outstanding0, RISKY.decimals, 6)} ${RISKY.symbol} · ${units(st.outstanding1, Q.decimals, 2)} ${Q.symbol}`
                : dash,
            ],
            [
              "Rebate pool",
              st
                ? `${units(st.rebatePool0, RISKY.decimals, 6)} ${RISKY.symbol} · ${units(st.rebatePool1, Q.decimals, 2)} ${Q.symbol}`
                : dash,
            ],
            [
              "Vesting buffer",
              st
                ? `${units(st.vest0, RISKY.decimals, 6)} ${RISKY.symbol} · ${units(st.vest1, Q.decimals, 2)} ${Q.symbol}`
                : dash,
            ],
            [
              "Owed in the ledger",
              s
                ? `${units(s.ledgerOwed.risky, RISKY.decimals, 6)} ${RISKY.symbol} · ${units(s.ledgerOwed.quote, Q.decimals, 2)} ${Q.symbol}`
                : dash,
            ],
          ]}
        />
        <p className="src">
          TouchstoneHook.poolState() · RebateLedger.totalOwed()
        </p>
      </div>
      <div className="live-col">
        <h3 className="h3">Thresholds and shares</h3>
        <KV
          rows={[
            [
              "Large swap N₀ · flow nMin",
              c ? `${usd(c.n0)} · ${usd(c.nMin)}` : dash,
            ],
            [
              "δ · δmax · β",
              c
                ? `${bps(c.deltaBps)} · ${bps(c.deltaMaxBps)} · ${c.betaX100 / 100}`
                : dash,
            ],
            ["ε · α", c ? `${bps(c.epsBps)} · ${c.alphaBps / 100}%` : dash],
            [
              "Settle after Δ · lag · window",
              c ? `${c.settleDelay} s · ${c.maxLag} s · ${c.window} s` : dash,
            ],
            [
              "Tip · ρ · κ",
              c
                ? `${bps(c.tipBps)} cap ${usd(c.tipCap)} · ${bps(c.rhoBps)} · ${bps(c.kappaBps)}`
                : dash,
            ],
          ]}
        />
        <p className="src">
          TouchstoneFactory.poolConfig(), fixed at registration. Testnet
          thresholds are lowered so small test swaps flag.
        </p>
      </div>
    </div>
  );
}

/** Settled and Expired do not name the deposit currency; the record's DepositTaken event does. */
function eventRow(e: RecordEvent, in0: Map<bigint, boolean>): [string, string] {
  const amt = (amount: bigint, depositIn0: boolean | undefined) =>
    depositIn0 === undefined
      ? `${amount} base units`
      : depositIn0
        ? `${units(amount, RISKY.decimals, 6)} ${RISKY.symbol}`
        : `${units(amount, Q.decimals, 2)} ${Q.symbol}`;
  switch (e.kind) {
    case "deposit":
      return [
        "Deposit taken",
        `${amt(e.deposit, e.depositIn0)} · ${e.mode === 1 ? "closure" : "continuous"} · ${utc(e.timestamp)} · ${shortAddr(e.sender)}`,
      ];
    case "settled":
      return [
        "Settled",
        `${e.benign ? "benign" : `α ${e.alphaBps / 100}%`} · markout ${usd(e.markout)} · refund ${amt(e.refund, in0.get(e.recordId))} · LPs ${amt(e.toLPs, in0.get(e.recordId))} · tip ${amt(e.tip, in0.get(e.recordId))}`,
      ];
    case "expired":
      return ["Expired", `refund ${amt(e.refund, in0.get(e.recordId))}`];
  }
}

export function Records({ live }: { live: Live }) {
  const ev = live.events;
  const in0 = new Map<bigint, boolean>();
  for (const e of ev ?? [])
    if (e.kind === "deposit") in0.set(e.recordId, e.depositIn0);
  return (
    <div className="live-block">
      <h3 className="data-title">
        Record history · measured from block {int(deployment.deployBlock)}
      </h3>
      {ev === null ? (
        <p className="empty">
          {(live.eventsError ?? live.error)
            ? `Not read: ${live.eventsError ?? live.error}`
            : "Reading events…"}
        </p>
      ) : ev.length === 0 ? (
        <p className="empty">
          No record has been opened on this pool yet. The first flagged swap,
          its settlement or its expiry will appear here, read from DepositTaken,
          Settled and Expired events.
        </p>
      ) : (
        <div className="tablewrap">
          <Table className="table">
            <TableHeader>
              <TableRow>
                <TableHead>Record</TableHead>
                <TableHead>Event</TableHead>
                <TableHead>Detail</TableHead>
                <TableHead>Block</TableHead>
                <TableHead>Transaction</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ev.slice(0, EVENT_ROWS).map((e) => {
                const [name, detail] = eventRow(e, in0);
                return (
                  <TableRow key={`${e.tx}-${e.logIndex}`}>
                    <TableCell className="mono">
                      #{e.recordId.toString()}
                    </TableCell>
                    <TableCell>{name}</TableCell>
                    <TableCell className="mono">{detail}</TableCell>
                    <TableCell className="mono">{int(e.block)}</TableCell>
                    <TableCell>
                      <a
                        href={explorerTx(e.tx)}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {shortAddr(e.tx)}
                      </a>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

const CONTRACTS: [string, string | null, string][] = [
  [
    "TouchstoneHook",
    deployment.contracts.hook,
    "Flags swaps, takes deposits, finalizes payouts",
  ],
  [
    "Settler",
    deployment.contracts.settler,
    "Settles records against signed Pyth prices; holds no funds",
  ],
  [
    "RebateLedger",
    deployment.contracts.ledger,
    "Rebates, and refunds that could not be pushed",
  ],
  [
    "TouchstoneFactory",
    deployment.contracts.factory,
    "Registers pools and checks every bound",
  ],
  [
    "GuardedRouter",
    deployment.contracts.guardedRouter,
    "Checks the real deposit inside the transaction",
  ],
  [
    "NyseCalendar",
    deployment.contracts.nyseCalendar,
    "NYSE sessions, holidays and early closes, 2026 to 2028",
  ],
  [
    "PoolManager (Uniswap v4)",
    deployment.uniswap.poolManager,
    "Runs the swap and calls the hook",
  ],
  ["Pyth", deployment.oracles.pyth, "Verifies signed price updates"],
];

export function Contracts() {
  return (
    <div className="live-block">
      <h3 className="data-title">Contracts on {deployment.name}</h3>
      <div className="tablewrap">
        <Table className="table">
          <TableHeader>
            <TableRow>
              <TableHead>Contract</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Address</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {CONTRACTS.map(
              ([name, addr, role]) =>
                addr && (
                  <TableRow key={name}>
                    <TableCell className="mono">{name}</TableCell>
                    <TableCell>{role}</TableCell>
                    <TableCell>
                      <a
                        href={explorerAddress(addr)}
                        target="_blank"
                        rel="noreferrer"
                        title={addr}
                      >
                        {addr}
                      </a>
                    </TableCell>
                  </TableRow>
                ),
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
