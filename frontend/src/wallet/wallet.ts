// Injected wallets through EIP-1193, discovered with EIP-6963 (decision 0060). The page never holds a key: every
// signature is the wallet's, after the user confirms it there.
import { z } from "zod";

export interface Eip1193Provider {
  request(args: { method: string; params?: readonly unknown[] | Record<string, unknown> }): Promise<unknown>;
  on?(event: string, handler: (...args: unknown[]) => void): void;
  removeListener?(event: string, handler: (...args: unknown[]) => void): void;
}

export interface WalletInfo {
  uuid: string;
  name: string;
  icon: string;
  rdns: string;
}

export interface DiscoveredWallet {
  info: WalletInfo;
  provider: Eip1193Provider;
}

// Announcements come from any extension on the page, so their fields are validated before use. The icon must be
// an inline image: it is rendered as an <img>, and the CSP allows images only from this origin and data: URLs.
const infoSchema = z.object({
  uuid: z.string().min(1).max(100),
  name: z.string().min(1).max(60),
  icon: z.string().max(200_000).regex(/^data:image\/(png|svg\+xml|webp|jpeg|gif);/),
  rdns: z.string().max(100),
});

export function isProvider(p: unknown): p is Eip1193Provider {
  return typeof p === "object" && p !== null && typeof (p as { request?: unknown }).request === "function";
}

/** Parses one eip6963:announceProvider detail; anything malformed is ignored. */
export function parseAnnouncement(detail: unknown): DiscoveredWallet | null {
  if (typeof detail !== "object" || detail === null) return null;
  const { info, provider } = detail as { info?: unknown; provider?: unknown };
  const parsed = infoSchema.safeParse(info);
  if (!parsed.success || !isProvider(provider)) return null;
  return { info: parsed.data, provider };
}

/** Collects wallets as they announce themselves; returns the unsubscribe. */
export function discoverWallets(onFound: (w: DiscoveredWallet) => void): () => void {
  const handler = (e: Event) => {
    const w = parseAnnouncement((e as CustomEvent).detail);
    if (w) onFound(w);
  };
  window.addEventListener("eip6963:announceProvider", handler);
  window.dispatchEvent(new Event("eip6963:requestProvider"));
  return () => window.removeEventListener("eip6963:announceProvider", handler);
}

/** A wallet that predates EIP-6963 and only sets window.ethereum. */
export function legacyWallet(): DiscoveredWallet | null {
  const eth = (window as unknown as { ethereum?: unknown }).ethereum;
  if (!isProvider(eth)) return null;
  return { info: { uuid: "legacy", name: "Browser wallet", icon: "", rdns: "" }, provider: eth };
}

const accountsSchema = z.array(z.string().regex(/^0x[0-9a-fA-F]{40}$/));
const chainIdSchema = z.string().regex(/^0x[0-9a-fA-F]+$/).transform((h) => Number.parseInt(h, 16));

export function parseAccounts(raw: unknown): `0x${string}`[] {
  return accountsSchema.parse(raw) as `0x${string}`[];
}

export function parseChainId(raw: unknown): number {
  return chainIdSchema.parse(raw);
}

export interface ChainParams {
  chainId: number;
  name: string;
  rpcUrl: string;
  explorer: string;
}

/** Asks the wallet to switch to `chain`, adding it first if the wallet does not know it (EIP-3326, EIP-3085). */
export async function switchChain(provider: Eip1193Provider, chain: ChainParams): Promise<void> {
  const chainId = `0x${chain.chainId.toString(16)}`;
  try {
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId }] });
  } catch (err) {
    // 4902: the wallet does not have this chain.
    if ((err as { code?: number }).code !== 4902) throw err;
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId,
          chainName: chain.name,
          rpcUrls: [chain.rpcUrl],
          nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
          blockExplorerUrls: [chain.explorer],
        },
      ],
    });
  }
}

/** Short human text for a wallet error; a user rejection reads as such, not as a failure. */
export function walletErrorText(err: unknown): string {
  const code = (err as { code?: number })?.code;
  if (code === 4001) return "Rejected in the wallet.";
  if (code === -32002) return "The wallet already has a pending request; open it to continue.";
  const msg = err instanceof Error ? ("shortMessage" in err && typeof err.shortMessage === "string" ? err.shortMessage : err.message) : "";
  if (/user rejected|denied/i.test(msg)) return "Rejected in the wallet.";
  return (msg || "The wallet returned an error.").split("\n")[0]!.slice(0, 200);
}
