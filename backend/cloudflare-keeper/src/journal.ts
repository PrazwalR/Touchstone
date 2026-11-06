import { keccak256, type Hex } from "viem";

export interface PendingTransaction { raw: Hex; hash: Hex; submittedAt: number }
export interface JournalStore {
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<boolean>;
}
export type Rpc = (args: { method: string; params?: unknown }) => Promise<unknown>;

/** Write-ahead journal: ambiguous sends are retried byte-for-byte, never with a fresh nonce. */
export class TransactionJournal {
  private readonly store: JournalStore;
  private readonly rpc: Rpc;
  constructor(store: JournalStore, rpc: Rpc) { this.store = store; this.rpc = rpc; }

  async recover(): Promise<boolean> {
    const pending = await this.store.get<PendingTransaction>("pending-transaction");
    if (!pending) return true;
    const receipt = await this.rpc({ method: "eth_getTransactionReceipt", params: [pending.hash] });
    if (receipt) { await this.store.delete("pending-transaction"); return true; }
    // Already-known, dropped and ambiguous send responses all leave the same journal in place.
    try { await this.rpc({ method: "eth_sendRawTransaction", params: [pending.raw] }); } catch { /* retry next alarm */ }
    return false;
  }

  async request(args: { method: string; params?: unknown }): Promise<unknown> {
    if (args.method !== "eth_sendRawTransaction") return this.rpc(args);
    const raw = (args.params as Hex[])[0]!;
    const prior = await this.store.get<PendingTransaction>("pending-transaction");
    if (prior && prior.raw !== raw && !await this.recover()) throw new Error("transaction_pending");
    const pending = { raw, hash: keccak256(raw), submittedAt: Date.now() };
    await this.store.put("pending-transaction", pending);
    return this.rpc(args);
  }
}
