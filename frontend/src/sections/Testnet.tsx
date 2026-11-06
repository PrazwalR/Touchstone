import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
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

function PoolFacts({ rows }: { rows: [string, string][] }) {
  return (
    <dl className="pool-facts">
      {rows.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function duration(seconds: number): string {
  if (seconds >= 3600 && seconds % 3600 === 0)
    return `${seconds / 3600} ${seconds === 3600 ? "hour" : "hours"}`;
  if (seconds >= 60 && seconds % 60 === 0)
    return `${seconds / 60} ${seconds === 60 ? "minute" : "minutes"}`;
  return `${seconds} ${seconds === 1 ? "second" : "seconds"}`;
}

/** A focused inspector: read status stays visible while each tab answers one question. */
export function PoolDetails({ live, now }: { live: Live; now: number }) {
  const s = live.snapshot;
  const st = s?.state;
  const c = s?.config;
  const dash = "—";
  const stale =
    Boolean(live.error) ||
    (live.readAt !== null && now - live.readAt > POLL_MS * 3);
  const price = s ? priceQuotePerRiskyE6(s.sqrtPriceX96) : null;
  const balances: [string, bigint | undefined, bigint | undefined][] = [
    ["Deposits held", st?.outstanding0, st?.outstanding1],
    ["Rebate pool", st?.rebatePool0, st?.rebatePool1],
    ["Vesting buffer", st?.vest0, st?.vest1],
    ["Owed in the ledger", s?.ledgerOwed.risky, s?.ledgerOwed.quote],
  ];
  return (
    <div className="pool-inspector">
      <div className="pool-read-status">
        <span>
          <i
            className={`state-dot ${stale ? "stale" : s ? "fresh" : ""}`}
            aria-hidden="true"
          />
          {s
            ? `${stale ? "Last successful read" : "Updated"} ${live.readAt ? ago(now - live.readAt) : ""}`
            : live.error
              ? "Pool data unavailable"
              : "Reading pool data…"}
        </span>
        <span>{s ? `Block ${int(s.blockNumber)}` : deployment.name}</span>
        <a
          href={explorerAddress(deployment.contracts.hook)}
          target="_blank"
          rel="noreferrer"
        >
          Verified hook ↗
        </a>
      </div>
      {live.error && (
        <p className="demo-error" role="alert">
          {live.error}
          {s ? " · Showing the last successful read." : ""}
        </p>
      )}
      <Tabs defaultValue="pool" className="pool-tabs">
        <TabsList aria-label="Pool data">
          <TabsTrigger value="pool">Pool</TabsTrigger>
          <TabsTrigger value="balances">Balances</TabsTrigger>
          <TabsTrigger value="configuration">Configuration</TabsTrigger>
        </TabsList>
        <TabsContent value="pool">
          <div className="pool-overview">
            <div className="pool-price">
              <h3>{pool.label}</h3>
              <span>Pool price</span>
              <strong>
                {price === null ? dash : units(price, 6, 2)}{" "}
                <small>
                  {Q.symbol} / {RISKY.symbol}
                </small>
              </strong>
              <p>The price left by the latest testnet swap.</p>
            </div>
            <PoolFacts
              rows={[
                ["LP fee", `${(s?.lpFee ?? pool.fee) / 100} bps`],
                ["Tick", s ? int(s.tick) : dash],
                ["Tick spacing", String(pool.tickSpacing)],
                ["In-range liquidity", s ? int(s.liquidity) : dash],
                ["Records opened", st ? int(st.nextRecordId) : dash],
              ]}
            />
          </div>
          <div className="pool-identity">
            <span>Pool ID</span>
            <code>{pool.poolId}</code>
            <span>
              {deployment.name} · chain {deployment.chainId}
            </span>
          </div>
          <p className="pool-source">
            Pool state from StateView. Hook and ledger state are read at the
            same block. Testnet figures do not establish LP returns.
          </p>
        </TabsContent>
        <TabsContent value="balances">
          <div className="pool-balance-head">
            <h3>Token balances</h3>
            <span>
              {st
                ? `${int(st.nextRecordId)} records opened`
                : "Reading records…"}
            </span>
          </div>
          <Table className="pool-balance-table">
            <TableHeader>
              <TableRow>
                <TableHead>Held in</TableHead>
                <TableHead>{RISKY.symbol}</TableHead>
                <TableHead>{Q.symbol}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {balances.map(([label, risky, quote]) => (
                <TableRow key={label}>
                  <TableCell>{label}</TableCell>
                  <TableCell>
                    {risky === undefined
                      ? dash
                      : units(risky, RISKY.decimals, 6)}
                  </TableCell>
                  <TableCell>
                    {quote === undefined ? dash : units(quote, Q.decimals, 2)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <p className="pool-source">
            Deposits, rebates and vesting are held by the hook; outstanding
            credits are read from the rebate ledger.
          </p>
        </TabsContent>
        <TabsContent value="configuration">
          <div className="pool-config-groups">
            <section>
              <h3>Deposit triggers</h3>
              <PoolFacts
                rows={[
                  ["Large-swap threshold", c ? usd(c.n0) : dash],
                  ["Flow threshold", c ? usd(c.nMin) : dash],
                  ["Drift threshold", c ? `${c.tauBps} bps` : dash],
                  ["Base deposit rate", c ? `${c.deltaBps} bps` : dash],
                  ["Maximum deposit rate", c ? `${c.deltaMaxBps} bps` : dash],
                  ["Gap multiplier", c ? `${c.betaX100 / 100}×` : dash],
                ]}
              />
            </section>
            <section>
              <h3>Settlement</h3>
              <PoolFacts
                rows={[
                  ["Eligible after", c ? duration(c.settleDelay) : dash],
                  ["Maximum price lag", c ? duration(c.maxLag) : dash],
                  ["Settlement window", c ? duration(c.window) : dash],
                  ["Base margin", c ? `${c.epsBps} bps` : dash],
                  ["Retention share", c ? `${c.alphaBps / 100}%` : dash],
                ]}
              />
            </section>
            <section>
              <h3>Payouts</h3>
              <PoolFacts
                rows={[
                  ["Settlement tip", c ? `${c.tipBps / 100}%` : dash],
                  ["Tip cap", c ? usd(c.tipCap) : dash],
                  ["Rebate pool share", c ? `${c.rhoBps / 100}%` : dash],
                  [
                    "Benign rebate · of LP fee",
                    c ? `${c.kappaBps / 100}%` : dash,
                  ],
                ]}
              />
            </section>
          </div>
          <p className="pool-source">
            Configuration is fixed when the pool is registered. Testnet
            thresholds are lowered so small trades can trigger deposits.
          </p>
        </TabsContent>
      </Tabs>
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
