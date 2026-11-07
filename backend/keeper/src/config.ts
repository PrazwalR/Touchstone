import { z } from "zod";
import { address, boolFlag, httpUrl, loadEnv, positiveInt } from "@touchstone/shared";

const hex32 = z.string().regex(/^0x[0-9a-fA-F]{64}$/, "expected a 32-byte hex id");
const addressList = z
  .string()
  .transform((s) => s.split(",").map((x) => x.trim()).filter((x) => x.length > 0))
  .pipe(z.array(address));

/** Keeper configuration, validated once at startup. Nothing financial has a default (spec §0.3). */
export const keeperEnvSchema = z.object({
  KEEPER_RPC_URL: httpUrl,
  KEEPER_CHAIN_ID: positiveInt,
  HERMES_URL: httpUrl,
  HERMES_API_KEY: z.string().min(1),
  // Pyth's documentation names the header; it is configuration so a change needs no release.
  HERMES_API_KEY_HEADER: z.string().min(1),
  HERMES_TIMEOUT_MS: positiveInt,
  KEEPER_KEYSTORE_PATH: z.string().min(1),
  KEEPER_KEYSTORE_PASSWORD_FILE: z.string().min(1),
  KEEPER_STATE_PATH: z.string().min(1),
  KEEPER_MIN_MARGIN_BPS: z.coerce.number().int().nonnegative(),
  KEEPER_SETTLE_AT_LOSS: boolFlag,
  KEEPER_POLL_INTERVAL_MS: positiveInt,
  KEEPER_LOG_BLOCK_RANGE: positiveInt,
  KEEPER_DRIPS_PER_PERIOD: positiveInt,
  KEEPER_NATIVE_PRICE_ID: hex32,
  KEEPER_PUSH_RECIPIENTS: addressList,
  TOUCHSTONE_HOOK: address,
  TOUCHSTONE_SETTLER: address,
  TOUCHSTONE_FACTORY: address,
  TOUCHSTONE_LEDGER: address,
  TOUCHSTONE_LICENCE: z.preprocess((v) => v === "" ? undefined : v, address.optional()),
  KEEPER_ACCRUE_INTERVAL_S: z.preprocess((v) => v === "" ? undefined : v, positiveInt.optional()),
  KEEPER_START_BLOCK: z.coerce.bigint().nonnegative(),
  // Optional: where the keeper publishes its metrics for the alert monitor, and the Hermes error-rate window.
  KEEPER_METRICS_PATH: z.preprocess((v) => v === "" ? undefined : v, z.string().min(1).optional()),
  KEEPER_HERMES_WINDOW_S: z.preprocess((v) => v === "" ? undefined : v, positiveInt.optional()),
  // Optional: seconds before a declined (unprofitable) record is re-checked; unset uses the keeper's built-in spacing.
  KEEPER_DECLINED_RETRY_S: z.preprocess((v) => v === "" ? undefined : v, positiveInt.optional()),
}).superRefine((cfg, ctx) => {
  if (cfg.KEEPER_METRICS_PATH !== undefined && cfg.KEEPER_HERMES_WINDOW_S === undefined) {
    ctx.addIssue({ code: "custom", path: ["KEEPER_HERMES_WINDOW_S"], message: "required when KEEPER_METRICS_PATH is configured" });
  }
  if (cfg.TOUCHSTONE_LICENCE !== undefined && cfg.KEEPER_ACCRUE_INTERVAL_S === undefined) {
    ctx.addIssue({ code: "custom", path: ["KEEPER_ACCRUE_INTERVAL_S"], message: "required when TOUCHSTONE_LICENCE is configured" });
  }
});

export type KeeperEnv = z.infer<typeof keeperEnvSchema>;

export const loadKeeperEnv = (source: NodeJS.ProcessEnv = process.env): KeeperEnv => loadEnv(keeperEnvSchema, source);
