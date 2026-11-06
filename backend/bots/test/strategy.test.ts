import { ContractFunctionExecutionError, ContractFunctionRevertedError, encodeErrorResult } from "viem";
import { guardedRouterAbi } from "@touchstone/shared";
import { describe, expect, it } from "vitest";
import {
  arbitrageDirection,
  seeded,
  spot,
  isDepositRefusal,
  planBid,
  sampleAmount,
} from "../src/strategy.ts";
import { botSchema } from "../src/config.ts";
describe("demo strategy", () => {
  it("reproduces a seed", () => {
    const a = seeded(42);
    const b = seeded(42);
    for (let i = 0; i < 100; i++) expect(a()).toBe(b());
  });
  it("maps buy and sell to the correct token ordering", () => {
    expect(arbitrageDirection(2000, 2100, 10, true)).toBe(true);
    expect(arbitrageDirection(2000, 2100, 10, false)).toBe(false);
    expect(arbitrageDirection(2100, 2000, 10, true)).toBe(false);
    expect(arbitrageDirection(2000, 2001, 10, true)).toBeNull();
  });
  it("normalizes token decimals", () => {
    const sqrt = BigInt(Math.floor(Math.sqrt(2000 * 10 ** -12) * 2 ** 96));
    expect(spot(sqrt, false, 6, 18)).toBeCloseTo(2000, 8);
    expect(spot(1n << 96n, true, 18, 18)).toBe(1);
  });
  it("samples large integer token amounts inside the configured range", () => {
    const min = 10n ** 30n;
    const rng = seeded(9);
    for (let i = 0; i < 100; i++) {
      const n = sampleAmount(rng, min, min + 123456n);
      expect(n >= min && n <= min + 123456n).toBe(true);
    }
  });
  it("accepts explicit bounded configuration and refuses mainnet or a zero output guard", () => {
    const valid = {
      BOT_RPC_URL: "https://rpc.example",
      BOT_CHAIN_ID: "421614",
      BOT_MODE: "retail",
      BOT_SEED: "42",
      BOT_SUBMIT: "false",
      BOT_ACCOUNT: `0x${"11".repeat(20)}`,
      BOT_KEYSTORE_PATH: "/private/keystore",
      BOT_PASSWORD_FILE: "/private/password",
      BOT_DEPLOYMENT_FILE: "/private/deployment.json",
      BOT_ZERO_FOR_ONE: "false",
      BOT_AMOUNT_MIN: "1",
      BOT_AMOUNT_MAX: "10",
      BOT_MIN_NET_OUT: "1",
      BOT_MIN_GROSS_OUT: "1",
      BOT_MAX_DEPOSIT: "5",
      BOT_SQRT_PRICE_LIMIT_X96: "12345",
      BOT_DEADLINE_SECONDS: "30",
      BOT_ITERATIONS: "1",
      BOT_INTERVAL_MS: "1000",
      BOT_MAX_GAS: "100000",
      BOT_MAX_GAS_PRICE_WEI: "1000000000",
      BOT_MIN_EDGE_BPS: "10",
      BOT_MAX_CONF_BPS: "25",
      BOT_PRICE_MAX_AGE_SECONDS: "30",
      HERMES_URL: "https://hermes.example",
      HERMES_API_KEY: "fixture",
      HERMES_API_KEY_HEADER: "Authorization",
      HERMES_TIMEOUT_MS: "1000",
    };
    expect(botSchema.safeParse(valid).success).toBe(true);
    expect(botSchema.safeParse({ ...valid, BOT_CHAIN_ID: "1" }).success).toBe(
      false,
    );
    expect(
      botSchema.safeParse({ ...valid, BOT_MIN_NET_OUT: "0" }).success,
    ).toBe(false);
    // Bidder mode needs all three lease limits; blank values count as absent.
    const bidder = { ...valid, BOT_MODE: "bidder", BOT_LEASE_MAX_RENT: "10", BOT_LEASE_SECONDS: "3600", BOT_LEASE_MAX_DEPOSIT: "36000" };
    expect(botSchema.safeParse(bidder).success).toBe(true);
    expect(botSchema.safeParse({ ...bidder, BOT_LEASE_MAX_DEPOSIT: "" }).success).toBe(false);
    expect(botSchema.safeParse({ ...bidder, BOT_LEASE_MAX_RENT: "0" }).success).toBe(false);
    expect(botSchema.safeParse({ ...valid, BOT_MODE: "holder" }).success).toBe(true);
  });
});

describe("licence bidder", () => {
  const self = `0x${"aa".repeat(20)}`;
  const other = `0x${"bb".repeat(20)}`;
  const empty = `0x${"00".repeat(20)}`;
  const view = { minNextRent: 10n, k: 60, holderOwner: other, pendingOwner: empty };
  const limits = { self, maxRent: 50n, leaseSeconds: 3_600, maxDeposit: 36_000n };
  it("bids the minimum rent with leaseSeconds of deposit", () =>
    expect(planBid(view, limits)).toEqual({ bid: true, rent: 10n, deposit: 36_000n }));
  it("never covers less than the notice", () =>
    expect(planBid(view, { ...limits, leaseSeconds: 10 })).toEqual({ bid: true, rent: 10n, deposit: 600n }));
  it("never outbids itself", () => {
    expect(planBid({ ...view, holderOwner: self.toUpperCase().replace("0X", "0x") }, limits)).toEqual({ bid: false, reason: "already holder" });
    expect(planBid({ ...view, pendingOwner: self }, limits)).toEqual({ bid: false, reason: "already pending" });
  });
  it("stays within its rent and deposit limits", () => {
    expect(planBid({ ...view, minNextRent: 51n }, limits)).toEqual({ bid: false, reason: "rent above limit" });
    expect(planBid(view, { ...limits, maxDeposit: 35_999n })).toEqual({ bid: false, reason: "deposit above limit" });
  });
  it("rejects nonsense inputs", () => {
    expect(() => planBid({ ...view, minNextRent: 0n }, limits)).toThrow();
    expect(() => planBid({ ...view, k: 0 }, limits)).toThrow();
  });
});

describe("holder guard", () => {
  const revert = (code: number) =>
    new ContractFunctionExecutionError(
      new ContractFunctionRevertedError({
        abi: guardedRouterAbi,
        functionName: "swapGuarded",
        data: encodeErrorResult({ abi: guardedRouterAbi, errorName: "Touchstone__GuardFailed", args: [code] }),
      }),
      { abi: guardedRouterAbi, functionName: "swapGuarded", args: [] },
    );
  it("recognises only the deposit refusal", () => {
    expect(isDepositRefusal(revert(1))).toBe(true);
    expect(isDepositRefusal(revert(2))).toBe(false);
    expect(isDepositRefusal(new Error("rpc down"))).toBe(false);
  });
});
