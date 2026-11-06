import { z } from "zod";
import { address, boolFlag, httpUrl, positiveInt } from "@touchstone/shared";

const uint = z
  .string()
  .regex(/^(0|[1-9][0-9]*)$/)
  .transform(BigInt)
  .refine((n) => n < 2n ** 128n);
const positive = uint.refine((n) => n > 0n);
const id = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
const blank = (v: unknown) => (v === "" ? undefined : v);
export const botSchema = z
  .object({
    BOT_RPC_URL: httpUrl,
    BOT_CHAIN_ID: z.coerce
      .number()
      .pipe(z.union([z.literal(421614), z.literal(84532)])),
    // holder swaps on the reference edge only while it holds the licence, refusing any deposit; bidder bids for it.
    BOT_MODE: z.enum(["retail", "outsider", "holder", "bidder"]),
    BOT_SEED: z.coerce
      .number()
      .int()
      .min(0)
      .max(2 ** 32 - 1),
    BOT_SUBMIT: boolFlag,
    BOT_ACCOUNT: address,
    BOT_KEYSTORE_PATH: z.string().min(1),
    BOT_PASSWORD_FILE: z.string().min(1),
    BOT_DEPLOYMENT_FILE: z.string().min(1),
    BOT_ZERO_FOR_ONE: boolFlag,
    BOT_AMOUNT_MIN: positive,
    BOT_AMOUNT_MAX: positive,
    BOT_MIN_NET_OUT: positive,
    BOT_MIN_GROSS_OUT: positive,
    BOT_MAX_DEPOSIT: uint,
    BOT_SQRT_PRICE_LIMIT_X96: z
      .string()
      .regex(/^\d+$/)
      .transform(BigInt)
      .refine((n) => n > 0n && n < 2n ** 160n),
    BOT_DEADLINE_SECONDS: positiveInt,
    BOT_ITERATIONS: positiveInt,
    BOT_INTERVAL_MS: positiveInt,
    BOT_MAX_GAS: positive,
    BOT_MAX_GAS_PRICE_WEI: positive,
    BOT_MAX_CONF_BPS: z.coerce.number().int().min(1).max(10_000),
    BOT_MIN_EDGE_BPS: z.coerce.number().positive().finite(),
    BOT_PRICE_MAX_AGE_SECONDS: positiveInt,
    BOT_LEASE_MAX_RENT: z.preprocess(blank, positive.optional()),
    BOT_LEASE_SECONDS: z.preprocess(blank, positiveInt.optional()),
    BOT_LEASE_MAX_DEPOSIT: z.preprocess(blank, positive.optional()),
    HERMES_URL: httpUrl,
    HERMES_API_KEY: z.string().min(1),
    HERMES_API_KEY_HEADER: z.string().min(1),
    HERMES_TIMEOUT_MS: positiveInt,
  })
  .refine((v) => v.BOT_AMOUNT_MAX >= v.BOT_AMOUNT_MIN, {
    message: "amount range reversed",
  })
  .refine(
    (v) =>
      v.BOT_MODE !== "bidder" ||
      (v.BOT_LEASE_MAX_RENT !== undefined && v.BOT_LEASE_SECONDS !== undefined && v.BOT_LEASE_MAX_DEPOSIT !== undefined),
    { message: "bidder mode requires BOT_LEASE_MAX_RENT, BOT_LEASE_SECONDS and BOT_LEASE_MAX_DEPOSIT" },
  );

const token = z.object({ address, decimals: z.number().int().min(0).max(36) });
export const deploymentSchema = z.object({
  chainId: z.number().int(),
  // Deployments made before M9 have no auction; the holder and bidder modes refuse to start without one.
  contracts: z.object({ hook: address, guardedRouter: address, licenceAuction: address.nullable().optional() }),
  uniswap: z.object({ stateView: address, poolManager: address }),
  oracles: z.object({ pythEthUsdId: id, pythUsdcUsdId: id }),
  tokens: z.object({ risky: token, quote: token }),
  pools: z
    .array(
      z.object({
        poolId: id,
        currency0: address,
        currency1: address,
        hooks: address,
        fee: z.number().int(),
        tickSpacing: z.number().int(),
      }),
    )
    .length(1),
});
