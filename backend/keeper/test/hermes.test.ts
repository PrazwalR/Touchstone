import { describe, expect, it } from "vitest";
import { Hermes, HermesError, toFloat } from "../src/hermes.ts";

const ID = `0x${"ab".repeat(32)}` as const;

function stub(status: number, body: unknown, seen: { url?: string; headers?: HeadersInit | undefined } = {}): typeof fetch {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    seen.url = String(url);
    seen.headers = init?.headers;
    return new Response(JSON.stringify(body), { status });
  }) as typeof fetch;
}

const ok = (publishTime: number) => ({
  binary: { encoding: "hex", data: ["deadbeef"] },
  parsed: [{ id: "ab".repeat(32), price: { price: "330000000000", conf: "1000", expo: -8, publish_time: publishTime }, ema_price: {} }],
});

const hermes = (f: typeof fetch) => new Hermes({ url: "https://hermes.example", apiKey: "k", apiKeyHeader: "x-api-key", timeoutMs: 1_000, fetchImpl: f });

describe("Hermes", () => {
  it("parses the first update at or after t and sends the key header", async () => {
    const seen: { url?: string; headers?: HeadersInit | undefined } = {};
    const u = await hermes(stub(200, ok(1_000), seen)).firstAtOrAfter(ID, 1_000);
    expect(u.data).toBe("0xdeadbeef");
    expect(u.publishTime).toBe(1_000);
    expect(toFloat(u)).toBeCloseTo(3_300);
    expect(seen.url).toContain("/v2/updates/price/1000?ids[]=0x");
    expect(seen.headers).toEqual(expect.objectContaining({ "x-api-key": "k" }));
  });

  it.each(["k", "Bearer k"])("accepts a raw or prefixed Bearer credential", async (apiKey) => {
    const seen: { headers?: HeadersInit } = {};
    const h = new Hermes({ url: "https://hermes.example", apiKey, apiKeyHeader: "Authorization", timeoutMs: 1000, fetchImpl: stub(200, ok(1000), seen) });
    await h.firstAtOrAfter(ID, 1000);
    expect(seen.headers).toEqual(expect.objectContaining({ Authorization: "Bearer k" }));
  });

  it("rejects an update published before t", async () => {
    await expect(hermes(stub(200, ok(999))).firstAtOrAfter(ID, 1_000)).rejects.toThrow(HermesError);
  });

  it("treats 404 as not yet available, and 401 as fatal", async () => {
    const notYet = await hermes(stub(404, {})).firstAtOrAfter(ID, 1).catch((e: HermesError) => e);
    expect(notYet).toBeInstanceOf(HermesError);
    expect((notYet as HermesError).retriable).toBe(true);
    const unauthorized = await hermes(stub(401, {})).firstAtOrAfter(ID, 1).catch((e: HermesError) => e);
    expect((unauthorized as HermesError).retriable).toBe(false);
  });

  it("rejects a malformed or mismatched response", async () => {
    await expect(hermes(stub(200, { parsed: [] })).firstAtOrAfter(ID, 1)).rejects.toThrow("malformed");
    const other = { ...ok(5), parsed: [{ id: "cd".repeat(32), price: { price: "1", conf: "0", expo: 0, publish_time: 5 } }] };
    await expect(hermes(stub(200, other)).firstAtOrAfter(ID, 1)).rejects.toThrow("no price");
  });
});

describe("Hermes boundary validation", () => {
  it.each([
    { field: "price", value: "0" },
    { field: "price", value: "-1" },
    { field: "conf", value: "-1" },
    { field: "expo", value: 1_000 },
    { field: "publish_time", value: -1 },
  ])("rejects invalid $field=$value", async ({ field, value }) => {
    const body = ok(5);
    Object.assign(body.parsed[0]!.price, { [field]: value });
    await expect(hermes(stub(200, body)).latest(ID)).rejects.toThrow(HermesError);
  });
  it("rejects odd-length binary hex", async () => {
    const body = ok(5);
    body.binary.data = ["abc"];
    await expect(hermes(stub(200, body)).latest(ID)).rejects.toThrow(HermesError);
  });
  it("classifies invalid JSON as a non-retriable Hermes error", async () => {
    const f = (async () => new Response("broken", { status: 200 })) as typeof fetch;
    await expect(hermes(f).latest(ID)).rejects.toMatchObject({ retriable: false });
  });
});

describe("Hermes error rate", () => {
  it("counts failures but not 'not published yet', and forgets requests outside the window", async () => {
    let now = 1_000;
    const responses = [404, 500, 200, 200];
    const f = (async () => {
      const status = responses.shift() ?? 200;
      return new Response(JSON.stringify(ok(1_000)), { status });
    }) as typeof fetch;
    const h = new Hermes({ url: "https://hermes.example", apiKey: "k", apiKeyHeader: "x-api-key", timeoutMs: 1_000, fetchImpl: f, now: () => now });
    await expect(h.latest(ID)).rejects.toThrow("404");
    await expect(h.latest(ID)).rejects.toThrow("500");
    await h.latest(ID);
    expect(h.stats(3_600)).toEqual({ windowSeconds: 3_600, requests: 3, errors: 1 });
    const failing = new Hermes({ url: "https://hermes.example", apiKey: "k", apiKeyHeader: "x-api-key", timeoutMs: 1_000, fetchImpl: (async () => { throw new Error("down"); }) as typeof fetch, now: () => now });
    await expect(failing.latest(ID)).rejects.toThrow("request failed");
    expect(failing.stats(60).errors).toBe(1);
    now += 3_601;
    await h.latest(ID);
    expect(h.stats(3_600)).toEqual({ windowSeconds: 3_600, requests: 1, errors: 0 });
  });
});
