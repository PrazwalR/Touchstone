import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { createWalletClient, custom, type Account, type Address, type Chain, type Transport, type WalletClient } from "viem";
import { chain } from "../chain/reads.ts";
import { deployment } from "../chain/deployment.ts";
import { RPC_URL } from "../config.ts";
import {
  discoverWallets,
  legacyWallet,
  parseAccounts,
  parseChainId,
  switchChain,
  walletErrorText,
  type DiscoveredWallet,
} from "./wallet.ts";

const REMEMBER = "touchstone.wallet";

export interface Wallet {
  wallets: DiscoveredWallet[];
  active: DiscoveredWallet | null;
  account: Address | null;
  chainId: number | null;
  /** True when the wallet is on the deployment's chain; only then may a transaction be built. */
  onRightChain: boolean;
  connecting: boolean;
  error: string | null;
  client: WalletClient<Transport, Chain, Account> | null;
  connect(w: DiscoveredWallet): Promise<void>;
  disconnect(): void;
  switchToDeployment(): Promise<void>;
  clearError(): void;
}

const Ctx = createContext<Wallet | null>(null);

function remember(rdns: string | null): void {
  try {
    if (rdns) localStorage.setItem(REMEMBER, rdns);
    else localStorage.removeItem(REMEMBER);
  } catch {
    // Storage may be unavailable (private windows); reconnecting is a convenience only.
  }
}

function remembered(): string | null {
  try {
    return localStorage.getItem(REMEMBER);
  } catch {
    return null;
  }
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const [wallets, setWallets] = useState<DiscoveredWallet[]>([]);
  const [active, setActive] = useState<DiscoveredWallet | null>(null);
  const [account, setAccount] = useState<Address | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const stop = discoverWallets((w) =>
      setWallets((prev) => (prev.some((p) => p.info.uuid === w.info.uuid) ? prev : [...prev, w])),
    );
    // Wallets that do not announce themselves still set window.ethereum; offer it if nothing else appears.
    const t = setTimeout(() => {
      const legacy = legacyWallet();
      if (legacy) setWallets((prev) => (prev.length === 0 ? [legacy] : prev));
    }, 400);
    return () => {
      stop();
      clearTimeout(t);
    };
  }, []);

  const adopt = useCallback(async (w: DiscoveredWallet, prompt: boolean) => {
    const raw = await w.provider.request({ method: prompt ? "eth_requestAccounts" : "eth_accounts" });
    const accounts = parseAccounts(raw);
    if (accounts.length === 0) return false;
    setActive(w);
    setAccount(accounts[0]!);
    setChainId(parseChainId(await w.provider.request({ method: "eth_chainId" })));
    remember(w.info.rdns || w.info.uuid);
    return true;
  }, []);

  // Silent reconnect to the wallet used last time: eth_accounts never prompts.
  useEffect(() => {
    if (active) return;
    const id = remembered();
    const w = wallets.find((x) => (x.info.rdns || x.info.uuid) === id);
    if (w) void adopt(w, false).catch(() => undefined);
  }, [wallets, active, adopt]);

  // Follow the wallet: an account or chain change in the extension updates the page.
  useEffect(() => {
    const p = active?.provider;
    if (!p?.on) return;
    const onAccounts = (raw: unknown) => {
      try {
        const a = parseAccounts(raw);
        if (a.length === 0) {
          setActive(null);
          setAccount(null);
          setChainId(null);
          remember(null);
        } else setAccount(a[0]!);
      } catch {
        setError("The wallet reported an invalid account.");
      }
    };
    const onChain = (raw: unknown) => {
      try {
        setChainId(parseChainId(raw));
      } catch {
        setError("The wallet reported an invalid chain.");
      }
    };
    p.on("accountsChanged", onAccounts);
    p.on("chainChanged", onChain);
    return () => {
      p.removeListener?.("accountsChanged", onAccounts);
      p.removeListener?.("chainChanged", onChain);
    };
  }, [active]);

  const connect = useCallback(
    async (w: DiscoveredWallet) => {
      setConnecting(true);
      setError(null);
      try {
        if (!(await adopt(w, true))) setError("The wallet shared no account.");
      } catch (err) {
        setError(walletErrorText(err));
      } finally {
        setConnecting(false);
      }
    },
    [adopt],
  );

  const disconnect = useCallback(() => {
    setActive(null);
    setAccount(null);
    setChainId(null);
    remember(null);
  }, []);

  const switchToDeployment = useCallback(async () => {
    if (!active) return;
    setError(null);
    try {
      await switchChain(active.provider, { chainId: deployment.chainId, name: deployment.name, rpcUrl: RPC_URL, explorer: deployment.explorer });
      setChainId(parseChainId(await active.provider.request({ method: "eth_chainId" })));
    } catch (err) {
      setError(walletErrorText(err));
    }
  }, [active]);

  const onRightChain = chainId === deployment.chainId;
  const client = useMemo(
    () =>
      active && account && onRightChain
        ? createWalletClient({ account, chain, transport: custom(active.provider) })
        : null,
    [active, account, onRightChain],
  );

  const value: Wallet = {
    wallets,
    active,
    account,
    chainId,
    onRightChain,
    connecting,
    error,
    client,
    connect,
    disconnect,
    switchToDeployment,
    clearError: () => setError(null),
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useWallet(): Wallet {
  const w = useContext(Ctx);
  if (!w) throw new Error("useWallet outside WalletProvider");
  return w;
}
