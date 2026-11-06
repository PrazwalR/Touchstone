import { z } from "zod";
import type { Hex } from "viem";

/**
 * One Pyth update as Hermes serves it: the signed blob the Settler forwards to Pyth, and the parsed price,
 * which the keeper uses only to check the publish time and to value a tip. The blob is never trusted: Pyth
 * verifies it on chain, and parsePriceFeedUpdatesUnique rejects anything but the first update at or after t0.
 */
export interface PythUpdate {
  id: Hex;
  data: Hex;
  price: bigint;
  conf: bigint;
  expo: number;
  publishTime: number;
}

const hexBody = z.string().regex(/^(0x)?(?:[0-9a-fA-F]{2})+$/);
const feedId = z.string().regex(/^(0x)?[0-9a-fA-F]{64}$/);
const priceString = z.string().regex(/^\d+$/).refine((v) => BigInt(v) > 0n && BigInt(v) <= (1n << 63n) - 1n);
const confidenceString = z.string().regex(/^\d+$/).refine((v) => BigInt(v) <= (1n << 64n) - 1n);

// Hermes adds fields over time; unknown ones are stripped, and every field the keeper reads is validated.
const responseSchema = z.object({
  binary: z.object({ encoding: z.literal("hex"), data: z.array(hexBody).min(1) }),
  parsed: z
    .array(
      z.object({
        id: feedId,
        price: z.object({ price: priceString, conf: confidenceString, expo: z.number().int().min(-(2 ** 31)).max(2 ** 31 - 1), publish_time: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER) }),
      }),
    )
    .min(1),
});

export class HermesError extends Error {
  readonly retriable: boolean;

  constructor(message: string, retriable: boolean) {
    super(message);
    this.retriable = retriable;
  }
}

const norm = (h: string): string => h.toLowerCase().replace(/^0x/, "");
const asHex = (h: string): Hex => `0x${norm(h)}`;

export interface HermesOptions {
  url: string;
  apiKey: string;
  apiKeyHeader: string;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
  /** Wall clock in seconds; injectable for tests. */
  now?: () => number;
}

/** Hermes requests and errors in a trailing window, for the error-rate alert (spec §15.6). */
export interface HermesStats {
  windowSeconds: number;
  requests: number;
  errors: number;
}

export class Hermes {
  readonly #o: HermesOptions;
  readonly #fetch: typeof fetch;
  readonly #now: () => number;
  // One entry per request: when, and whether it failed. A 404 is "not published yet", the normal answer before
  // t0's update exists, so it is not an error.
  readonly #log: { t: number; error: boolean }[] = [];

  constructor(o: HermesOptions) {
    this.#o = o;
    this.#fetch = o.fetchImpl ?? fetch;
    this.#now = o.now ?? (() => Math.floor(Date.now() / 1000));
  }

  /** Requests and errors in the last `windowSeconds`; older entries are dropped. */
  stats(windowSeconds: number): HermesStats {
    const from = this.#now() - windowSeconds;
    while (this.#log.length > 0 && this.#log[0]!.t < from) this.#log.shift();
    return { windowSeconds, requests: this.#log.length, errors: this.#log.filter((e) => e.error).length };
  }

  /** The first update for `id` published at or after `t` (Hermes' timestamp endpoint). One feed per call,
   * because the base and quote feeds' first updates can sit in different blobs (spec §15.1 step 3). */
  async firstAtOrAfter(id: Hex, t: number): Promise<PythUpdate> {
    const u = await this.#get(`/v2/updates/price/${t}?ids[]=${asHex(id)}&encoding=hex&parsed=true`, id);
    if (u.publishTime < t) throw new HermesError(`update for ${id} published at ${u.publishTime}, before ${t}`, false);
    return u;
  }

  /** The latest update for `id`, used only to value gas in the native token. */
  async latest(id: Hex): Promise<PythUpdate> {
    return this.#get(`/v2/updates/price/latest?ids[]=${asHex(id)}&encoding=hex&parsed=true`, id);
  }

  async #get(path: string, id: Hex): Promise<PythUpdate> {
    const entry = { t: this.#now(), error: true };
    this.#log.push(entry);
    const update = await this.#request(path, id).catch((err: unknown) => {
      if (err instanceof HermesError && err.message === "Hermes returned 404") entry.error = false;
      throw err;
    });
    entry.error = false;
    return update;
  }

  async #request(path: string, id: Hex): Promise<PythUpdate> {
    let res: Response;
    try {
      res = await this.#fetch(`${this.#o.url}${path}`, {
        headers: { [this.#o.apiKeyHeader]: this.#o.apiKey, accept: "application/json" },
        signal: AbortSignal.timeout(this.#o.timeoutMs),
      });
    } catch (err) {
      throw new HermesError(`request failed: ${err instanceof Error ? err.message : String(err)}`, true);
    }
    // 404 means the update is not published yet; 429 and 5xx are transient. Anything else is a bug or a key problem.
    if (!res.ok) throw new HermesError(`Hermes returned ${res.status}`, res.status === 404 || res.status === 429 || res.status >= 500);
    let bodyJson: unknown;
    try {
      bodyJson = await res.json();
    } catch {
      throw new HermesError("malformed Hermes JSON", false);
    }
    const parsed = responseSchema.safeParse(bodyJson);
    if (!parsed.success) throw new HermesError("malformed Hermes response", false);
    const body = parsed.data;
    const p = body.parsed.find((x) => norm(x.id) === norm(id));
    if (p === undefined) throw new HermesError(`Hermes response has no price for ${id}`, false);
    if (body.binary.data.length !== 1) throw new HermesError("expected one update blob per single-feed request", false);
    const value = Number(p.price.price) * 10 ** p.price.expo;
    if (!Number.isFinite(value) || value <= 0) throw new HermesError("invalid Hermes price scale", false);
    return {
      id: asHex(p.id),
      data: asHex(body.binary.data[0] ?? ""),
      price: BigInt(p.price.price),
      conf: BigInt(p.price.conf),
      expo: p.price.expo,
      publishTime: p.price.publish_time,
    };
  }
}

/** price * 10^expo as a JavaScript number, for valuing tips and gas only; never for an amount sent on chain. */
export const toFloat = (u: Pick<PythUpdate, "price" | "expo">): number => Number(u.price) * 10 ** u.expo;
