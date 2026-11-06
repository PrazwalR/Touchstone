import { DurableObject } from "cloudflare:workers";
import { timingSafeEqual } from "node:crypto";
import { configuration, failureCode, type Env } from "./config.ts";
import { createRuntime } from "./runtime.ts";
import type { KeeperState } from "../../keeper/src/state.ts";
import type { PendingTransaction } from "./journal.ts";

const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { "cache-control": "no-store" } });

function deploymentIdentity(env: Env): string {
  const { keeper: e } = configuration(env);
  return [e.KEEPER_CHAIN_ID, e.KEEPER_START_BLOCK.toString(), e.TOUCHSTONE_HOOK.toLowerCase(),
    e.TOUCHSTONE_SETTLER.toLowerCase(), e.TOUCHSTONE_FACTORY.toLowerCase(), e.TOUCHSTONE_LEDGER.toLowerCase()].join(":");
}

export function authorized(request: Request, token?: string): boolean {
  if (!token || token.length < 32) return false;
  const supplied = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${token}`);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

export class KeeperObject extends DurableObject<Env> {
  private runtime: Awaited<ReturnType<typeof createRuntime>> | undefined;

  override async fetch(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname;
    const storage = this.ctx.storage;
    if (path === "/start" && request.method === "POST") {
      const identity = deploymentIdentity(this.env);
      const savedIdentity = await storage.get<string>("deployment");
      if (savedIdentity && savedIdentity !== identity) return json({ error: "deployment_changed_use_new_worker_namespace" }, 409);
      await storage.put({ deployment: identity, enabled: true });
      await storage.setAlarm(Date.now() + 1000);
      return json({ enabled: true, message: "Scheduled; check /status for the first successful tick." });
    }
    if (path === "/stop" && request.method === "POST") {
      await storage.put("enabled", false);
      await storage.deleteAlarm();
      return json({ enabled: false, message: "An in-flight transaction may still complete." });
    }
    if (path === "/watchdog" && request.method === "POST") {
      if (await storage.get<boolean>("enabled") && await storage.getAlarm() === null) await storage.setAlarm(Date.now() + 1000);
      return json({ ok: true });
    }
    if (path === "/status" && request.method === "GET") {
      const state = await storage.get<KeeperState>("keeper-state");
      const pending = await storage.get<PendingTransaction>("pending-transaction");
      return json({ enabled: await storage.get<boolean>("enabled") ?? false,
        nextAlarm: await storage.getAlarm(),
        nextBlock: state?.nextBlock.toString() ?? null, openRecords: state?.open.length ?? 0,
        pendingTransaction: pending?.hash ?? null, lastTick: await storage.get("last-tick") ?? null });
    }
    return json({ error: "not_found" }, 404);
  }

  override async alarm(): Promise<void> {
    const storage = this.ctx.storage;
    if (!await storage.get<boolean>("enabled")) return;
    // Install a recovery alarm before any network I/O or signing, including CPU-limit termination.
    await storage.setAlarm(Date.now() + 30000);
    let delay = 30000;
    try {
      if (await storage.get<string>("deployment") !== deploymentIdentity(this.env)) throw new Error("deployment_changed_use_new_worker_namespace");
      this.runtime ??= await createRuntime(this.env, storage, await storage.get<KeeperState>("keeper-state"));
      const r = this.runtime;
      delay = r.cf.CF_ERROR_POLL_MS;
      if (await r.journal.recover()) {
        const report = await r.keeper.tick({ maxBlocks: r.blockRange, maxRecords: 1, housekeeping: r.cf.CF_HOUSEKEEPING });
        const state = r.keeper.state();
        await storage.put({ "keeper-state": state, "last-tick": {
          at: Date.now(), ok: true, account: r.account, ...report,
        } });
        // Use the captured scan cursor for catch-up; this extra head read is intentionally read-only.
        const behind = state.nextBlock <= await r.client.getBlockNumber({ cacheTime: 0 });
        delay = state.open.length || behind ? r.cf.CF_ACTIVE_POLL_MS : r.cf.CF_IDLE_POLL_MS;
      } else {
        // No fresh transaction may be signed until the journaled transaction is confirmed.
        delay = r.cf.CF_ACTIVE_POLL_MS;
        await storage.put("last-tick", { at: Date.now(), ok: false, error: "transaction_pending", account: r.account });
      }
    } catch (error) {
      // Discard uncheckpointed in-memory changes after failure. The signed transaction journal survives.
      this.runtime = undefined;
      const code = failureCode(error);
      await storage.put("last-tick", { at: Date.now(), ok: false, error: code });
      console.error(JSON.stringify({ service: "cloudflare-keeper", error: code }));
    } finally {
      if (await storage.get<boolean>("enabled")) await storage.setAlarm(Date.now() + delay);
      else await storage.deleteAlarm();
    }
  }
}

function stub(env: Env) {
  return env.KEEPER.get(env.KEEPER.idFromName("touchstone-single-signer-v1"));
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (path === "/health" && request.method === "GET") return json({ service: "touchstone-cloudflare-keeper", alive: true });
    if (!authorized(request, env.ADMIN_TOKEN)) return json({ error: "unauthorized" }, 401);
    if (!["/start", "/stop", "/status"].includes(path)) return json({ error: "not_found" }, 404);
    try { return await stub(env).fetch(request); }
    catch { return json({ error: "keeper_request_failed" }, 500); }
  },
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(stub(env).fetch(new Request("https://keeper.internal/watchdog", { method: "POST" })));
  },
} satisfies ExportedHandler<Env>;
