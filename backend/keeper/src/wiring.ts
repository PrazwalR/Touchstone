import { createPublicClient, http, type Abi, type Address, type PublicClient } from "viem";
import { licenceAuctionAbi, settlerAbi, touchstoneFactoryAbi, touchstoneHookAbi } from "@touchstone/shared";

export interface WiringAddresses {
  hook: Address;
  settler: Address;
  factory: Address;
  ledger: Address;
  licence?: Address;
}

/**
 * Read-only checks that the configured addresses are one deployment on the configured chain: every contract has
 * code and the immutables point at each other. Returns the problems found; empty means wired. A keeper pointed at
 * a mismatched set would settle against the wrong hook or never see its records, so startup refuses it.
 */
export async function checkWiring(client: Pick<PublicClient, "getChainId" | "getCode" | "readContract">, chainId: number, at: WiringAddresses): Promise<string[]> {
  const problems: string[] = [];
  const actual = await client.getChainId();
  if (actual !== chainId) return [`RPC serves chain ${actual}, configured ${chainId}`];
  const named = Object.entries(at).filter((e): e is [string, Address] => e[1] !== undefined);
  const codes = await Promise.all(named.map(([, a]) => client.getCode({ address: a })));
  named.forEach(([name], i) => {
    if (!codes[i] || codes[i] === "0x") problems.push(`${name} has no code`);
  });
  if (problems.length) return problems;
  const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
  // Each view is read on its own, so a contract from an older release names the call it lacks instead of failing
  // the whole check.
  const read = async (address: Address, abi: Abi, functionName: string, label: string): Promise<string | undefined> => {
    try {
      return (await client.readContract({ address, abi, functionName })) as string;
    } catch {
      problems.push(`${label} could not be read; the contract may predate this release`);
      return undefined;
    }
  };
  const expect = (got: string | undefined, want: string, message: string) => {
    if (got !== undefined && !same(got, want)) problems.push(message);
  };
  const [hookSettler, hookLedger, hookFactory, settlerHook, factoryHook] = await Promise.all([
    read(at.hook, touchstoneHookAbi, "SETTLER", "hook.SETTLER"),
    read(at.hook, touchstoneHookAbi, "LEDGER", "hook.LEDGER"),
    read(at.hook, touchstoneHookAbi, "FACTORY", "hook.FACTORY"),
    read(at.settler, settlerAbi, "HOOK", "settler.HOOK"),
    read(at.factory, touchstoneFactoryAbi, "HOOK", "factory.HOOK"),
  ]);
  expect(hookSettler, at.settler, "hook.SETTLER differs from the configured settler");
  expect(hookLedger, at.ledger, "hook.LEDGER differs from the configured ledger");
  expect(hookFactory, at.factory, "hook.FACTORY differs from the configured factory");
  expect(settlerHook, at.hook, "settler.HOOK differs from the configured hook");
  expect(factoryHook, at.hook, "factory.HOOK differs from the configured hook");
  if (at.licence !== undefined) {
    const [hookLicence, auctionHook] = await Promise.all([
      read(at.hook, touchstoneHookAbi, "LICENCE", "hook.LICENCE"),
      read(at.licence, licenceAuctionAbi, "HOOK", "auction.HOOK"),
    ]);
    expect(hookLicence, at.licence, "hook.LICENCE differs from the configured auction");
    expect(auctionHook, at.hook, "auction.HOOK differs from the configured hook");
  }
  return problems;
}

/** The wiring check against an RPC URL, for the preflight, which has no client of its own. */
export function checkWiringAt(rpcUrl: string, chainId: number, at: WiringAddresses): Promise<string[]> {
  return checkWiring(createPublicClient({ transport: http(rpcUrl, { timeout: 15_000 }) }), chainId, at);
}
