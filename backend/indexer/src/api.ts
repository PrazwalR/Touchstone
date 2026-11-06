import { createServer, type Server } from "node:http";
import { z } from "zod";
import type { History, HistoryKind } from "./history.ts";

const MAX_OFFSET = 1_000_000;
const MAX_HEADER_BYTES = 8192;
const REQUEST_TIMEOUT_MS = 10_000;

export const apiEnvSchema = z.object({
  INDEXER_API_HOST: z.string().min(1),
  INDEXER_API_PORT: z.coerce.number().int().min(1).max(65535),
  INDEXER_API_ORIGINS: z
    .string()
    .transform((s) => s.split(",").map((v) => v.trim()))
    .pipe(
      z
        .array(
          z.url().refine((v) => new URL(v).origin === v && /^https?:/.test(v)),
        )
        .min(1),
    ),
  INDEXER_API_REQUESTS_PER_WINDOW: z.coerce.number().int().positive(),
  INDEXER_API_WINDOW_MS: z.coerce.number().int().positive(),
  INDEXER_API_MAX_CLIENTS: z.coerce.number().int().positive(),
  INDEXER_API_MAX_PAGE_SIZE: z.coerce.number().int().min(1).max(1000),
  INDEXER_CHAIN: z.string().regex(/^[a-z0-9-]+$/),
  INDEXER_DATABASE_PATH: z.string().min(1),
});
export type ApiConfig = z.infer<typeof apiEnvSchema>;
const hash = z
  .string()
  .regex(/^0x[0-9a-fA-F]{64}$/)
  .transform((s) => s.toLowerCase());
const address = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/)
  .transform((s) => s.toLowerCase());

/** GET-only public data; never trusts forwarding headers or opens a signing client. */
export function historyServer(history: History, cfg: ApiConfig): Server {
  const clients = new Map<string, { until: number; count: number }>();
  return createServer(
    {
      maxHeaderSize: MAX_HEADER_BYTES,
      requestTimeout: REQUEST_TIMEOUT_MS,
      headersTimeout: REQUEST_TIMEOUT_MS,
    },
    (req, res) => {
      const reply = (status: number, body: unknown) => {
        res.writeHead(status, {
          "content-type": "application/json; charset=utf-8",
          "cache-control": "no-store",
          "x-content-type-options": "nosniff",
          "referrer-policy": "no-referrer",
          "content-security-policy":
            "default-src 'none'; frame-ancestors 'none'",
          "strict-transport-security": "max-age=31536000",
          vary: "Origin",
        });
        res.end(JSON.stringify(body));
      };
      const now = Date.now();
      for (const [key, v] of clients) if (v.until <= now) clients.delete(key);
      const key = req.socket.remoteAddress ?? "unknown";
      const previous = clients.get(key);
      if (
        previous === undefined &&
        clients.size >= cfg.INDEXER_API_MAX_CLIENTS
      ) {
        reply(429, { error: "rate limited" });
        return;
      }
      const bucket = previous ?? {
        until: now + cfg.INDEXER_API_WINDOW_MS,
        count: 0,
      };
      clients.set(key, bucket);
      if (++bucket.count > cfg.INDEXER_API_REQUESTS_PER_WINDOW) {
        res.setHeader("Retry-After", Math.ceil((bucket.until - now) / 1000));
        reply(429, { error: "rate limited" });
        return;
      }
      const origin = req.headers.origin;
      if (origin !== undefined && !cfg.INDEXER_API_ORIGINS.includes(origin)) {
        reply(403, { error: "origin denied" });
        return;
      }
      if (origin !== undefined)
        res.setHeader("Access-Control-Allow-Origin", origin);
      if (req.method !== "GET") {
        res.setHeader("Allow", "GET");
        reply(405, { error: "GET required" });
        return;
      }
      try {
        const url = new URL(req.url ?? "/", "http://localhost");
        if (
          [...new Set(url.searchParams.keys())].some(
            (k) => url.searchParams.getAll(k).length !== 1,
          )
        ) {
          reply(400, { error: "duplicate parameter" });
          return;
        }
        const params = Object.fromEntries(url.searchParams);
        if (url.pathname === "/v1/health") {
          if (Object.keys(params).length) {
            reply(400, { error: "unexpected parameter" });
            return;
          }
          reply(200, history.health());
          return;
        }
        if (url.pathname === "/v1/licence/summary") {
          const parsed = z.strictObject({ poolId: hash }).safeParse(params);
          if (!parsed.success) {
            reply(400, { error: "invalid query" });
            return;
          }
          reply(200, history.licenceSummary(parsed.data.poolId));
          return;
        }
        const kind: HistoryKind | null =
          url.pathname === "/v1/records"
            ? "records"
            : url.pathname === "/v1/ledger"
              ? "ledger"
              : url.pathname === "/v1/licence"
                ? "licence"
                : null;
        if (kind === null) {
          reply(404, { error: "not found" });
          return;
        }
        const integer = z.string().regex(/^(0|[1-9][0-9]*)$/);
        const schema = z.strictObject({
          ...(kind === "records"
            ? {
                poolId: hash.optional(),
                recordId: integer
                  .refine((s) => BigInt(s) < 2n ** 64n)
                  .optional(),
              }
            : kind === "ledger"
              ? { recipient: address.optional() }
              : { poolId: hash.optional(), owner: address.optional() }),
          limit: integer
            .transform(Number)
            .pipe(z.number().int().min(1).max(cfg.INDEXER_API_MAX_PAGE_SIZE))
            .default(Math.min(20, cfg.INDEXER_API_MAX_PAGE_SIZE)),
          offset: integer
            .transform(Number)
            .pipe(z.number().int().min(0).max(MAX_OFFSET))
            .default(0),
        });
        const parsed = schema.safeParse(params);
        if (!parsed.success) {
          reply(400, { error: "invalid query" });
          return;
        }
        const q = parsed.data;
        reply(200, {
          chain: cfg.INDEXER_CHAIN,
          label: "measured indexed events",
          items: history.events(kind, q),
          limit: q.limit,
          offset: q.offset,
        });
      } catch {
        reply(503, { error: "history unavailable" });
      }
    },
  );
}
