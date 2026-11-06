import { renameSync, writeFileSync } from "node:fs";
import { z } from "zod";

/**
 * What the keeper publishes for the alert monitor after every tick: the account it signs with, what it spent on
 * gas in the last day, and Hermes' recent error rate. Nothing secret, nothing the monitor could act on.
 */
export const keeperMetricsSchema = z.strictObject({
  version: z.literal(1),
  updatedAt: z.number().int().positive(),
  chainId: z.number().int().positive(),
  account: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  spent24hWei: z.string().regex(/^(0|[1-9][0-9]*)$/),
  hermes: z.strictObject({
    windowSeconds: z.number().int().positive(),
    requests: z.number().int().nonnegative(),
    errors: z.number().int().nonnegative(),
  }),
  openRecords: z.number().int().nonnegative(),
});
export type KeeperMetrics = z.infer<typeof keeperMetricsSchema>;

/** Written to a temporary file and renamed, so a reader never sees half a file. */
export function writeMetrics(path: string, m: KeeperMetrics): void {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(keeperMetricsSchema.parse(m))}\n`, { mode: 0o644 });
  renameSync(tmp, path);
}
