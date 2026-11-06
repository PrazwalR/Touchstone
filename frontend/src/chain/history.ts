import { z } from "zod";

export const historyEvent = z.strictObject({
  tx: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  logIndex: z.number().int().nonnegative(),
  block: z.string().regex(/^\d+$/),
  name: z.enum([
    "DepositTaken",
    "Settled",
    "Expired",
    "RefundDeferred",
    "Credited",
    "Claimed",
  ]),
  args: z.record(z.string(), z.unknown()),
});
const pageSchema = z.strictObject({
  chain: z.string(),
  label: z.string(),
  items: z.array(historyEvent),
  limit: z.number().int().positive(),
  offset: z.number().int().nonnegative(),
});
export type HistoryEvent = z.infer<typeof historyEvent>;

/** Licence events as the indexer API serves them (backend/indexer/src/history.ts LICENCE_EVENTS). */
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
const integer = z.string().regex(/^(0|[1-9][0-9]*)$/);
export const licenceEvent = historyEvent.extend({ name: z.enum(LICENCE_EVENTS) });
export const licencePageSchema = z.strictObject({
  chain: z.string(),
  label: z.string(),
  items: z.array(licenceEvent),
  limit: z.number().int().positive(),
  offset: z.number().int().nonnegative(),
});
const eventRef = z
  .strictObject({ tx: z.string(), block: integer, args: z.record(z.string(), z.unknown()) })
  .nullable();
export const licenceSummarySchema = z.strictObject({
  chain: z.string(),
  poolId: z.string().regex(/^0x[0-9a-f]{64}$/),
  label: z.literal("measured indexed events"),
  counts: z.record(z.enum(LICENCE_EVENTS), z.number().int().nonnegative()),
  rentCharged: integer,
  rentCredited: integer,
  toRebatePool: integer,
  toVesting: integer,
  rentInFlight: z.string().regex(/^-?(0|[1-9][0-9]*)$/),
  lastActivation: eventRef,
  lastLapse: eventRef,
});
export type LicenceEvent = z.infer<typeof licenceEvent>;
export type LicenceSummary = z.infer<typeof licenceSummarySchema>;
export const healthSchema = z.strictObject({
  chain: z.string(),
  counts: z.array(
    z.strictObject({
      status: z.enum(["open", "settled", "expired"]),
      count: z.number().int().nonnegative(),
    }),
  ),
  deferred: z.strictObject({ count: z.number().int().nonnegative() }),
  cursor: z
    .strictObject({ nextBlock: z.string(), lastHash: z.string() })
    .nullable(),
  settlementLagSeconds: z
    .strictObject({
      count: z.number().int().positive(),
      median: z.number().finite().nonnegative(),
      p95: z.number().int().nonnegative(),
      sampleLimit: z.number().int().positive(),
    })
    .nullable(),
  lpNetEstimate: z.null(),
  unavailable: z.array(z.string()),
});
export type HistoryHealth = z.infer<typeof healthSchema>;

/** Public history only; credentials are never sent to the API. */
export async function readHistory(
  base: string,
  route: string,
  chain: string,
  signal: AbortSignal,
): Promise<unknown> {
  const url = new URL(base);
  url.pathname = `${url.pathname.replace(/\/$/, "")}/v1/${route.split("?")[0]}`;
  url.search = route.includes("?") ? route.slice(route.indexOf("?")) : "";
  const res = await fetch(url, {
    signal,
    credentials: "omit",
    redirect: "error",
  });
  if (!res.ok) throw new Error(`History API returned ${res.status}`);
  const raw: unknown = await res.json();
  const path = route.split("?")[0];
  const parsed =
    path === "health"
      ? healthSchema.parse(raw)
      : path === "licence/summary"
        ? licenceSummarySchema.parse(raw)
        : path === "licence"
          ? licencePageSchema.parse(raw)
          : pageSchema.parse(raw);
  if (parsed.chain !== chain)
    throw new Error("History API is configured for a different chain");
  return parsed;
}
export { pageSchema };
