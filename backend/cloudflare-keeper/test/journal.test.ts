import { describe, it, expect, vi } from "vitest";
import { keccak256 } from "viem";
import { TransactionJournal, type JournalStore, type PendingTransaction } from "../src/journal.ts";

function store() {
  const data = new Map<string, unknown>();
  return { data, get: async <T>(k: string) => data.get(k) as T | undefined,
    put: async <T>(k: string, v: T) => { data.set(k, v); }, delete: async (k: string) => data.delete(k) } satisfies JournalStore & { data: Map<string, unknown> };
}
const raw = "0x123456" as const;
const send = { method: "eth_sendRawTransaction", params: [raw] };
describe("persistent transaction journal", () => {
  it("persists signed bytes before broadcasting, even if the RPC response is lost", async () => {
    const s = store();
    const rpc = vi.fn(async () => {
      expect(s.data.get("pending-transaction")).toMatchObject({ raw, hash: keccak256(raw) });
      throw Error("timeout");
    });
    await expect(new TransactionJournal(s, rpc).request(send)).rejects.toThrow("timeout");
    expect(s.data.has("pending-transaction")).toBe(true);
  });
  it("a new runtime rebroadcasts the exact same signed transaction after a crash", async () => {
    const s = store();
    s.data.set("pending-transaction", { raw, hash: keccak256(raw), submittedAt: 1 });
    const rpc = vi.fn(async ({ method }: { method: string }) => method === "eth_getTransactionReceipt" ? null : keccak256(raw));
    expect(await new TransactionJournal(s, rpc).recover()).toBe(false);
    expect(rpc).toHaveBeenLastCalledWith(send);
    expect(s.data.has("pending-transaction")).toBe(true);
  });
  it("blocks a different signed transaction while the preceding nonce is unresolved", async () => {
    const s = store();
    s.data.set("pending-transaction", { raw, hash: keccak256(raw), submittedAt: 1 });
    const rpc = vi.fn(async (_args: { method: string; params?: unknown }) => null);
    await expect(new TransactionJournal(s, rpc).request({ ...send, params: ["0xabcd"] })).rejects.toThrow("transaction_pending");
    expect(rpc.mock.calls.some(([args]) => (args.params as string[] | undefined)?.[0] === "0xabcd")).toBe(false);
  });
  it.each(["0x1", "0x0"])("clears a mined transaction even when receipt status is %s", async status => {
    const s = store();
    s.data.set("pending-transaction", { raw, hash: keccak256(raw), submittedAt: 1 } satisfies PendingTransaction);
    expect(await new TransactionJournal(s, async () => ({ status })).recover()).toBe(true);
    expect(s.data.has("pending-transaction")).toBe(false);
  });
  it("does not discard the journal when a receipt lookup fails", async () => {
    const s = store(); s.data.set("pending-transaction", { raw, hash: keccak256(raw), submittedAt: 1 });
    await expect(new TransactionJournal(s, async () => { throw Error("RPC down"); }).recover()).rejects.toThrow();
    expect(s.data.has("pending-transaction")).toBe(true);
  });
});
