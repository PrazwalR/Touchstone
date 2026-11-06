import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { selectDeployment } from "../src/chain/selectDeployment.ts";
import { deployment, parseDeployment } from "../src/chain/deployment.ts";

const here = dirname(fileURLToPath(import.meta.url));

const raw = JSON.parse(readFileSync(join(here, "..", "deployments", "arbitrum-sepolia.json"), "utf8")) as Record<string, unknown>;
const contractsJson = JSON.parse(readFileSync(join(here, "..", "..", "contracts", "deployments", "arbitrum-sepolia.json"), "utf8")) as Record<string, string>;

describe("deployment file", () => {
  it("parses and matches the contracts workspace", () => {
    expect(deployment.chainId).toBe(421614);
    expect(deployment.contracts.hook.toLowerCase()).toBe(contractsJson.hook.toLowerCase());
    expect(deployment.contracts.settler.toLowerCase()).toBe(contractsJson.settler.toLowerCase());
    expect(deployment.contracts.ledger.toLowerCase()).toBe(contractsJson.ledger.toLowerCase());
    expect(deployment.contracts.factory.toLowerCase()).toBe(contractsJson.factory.toLowerCase());
  });

  it("requires a synced deployment for the requested chain", () => {
    expect(selectDeployment().chain).toBe("arbitrum-sepolia");
    expect(() => selectDeployment("missing-chain")).toThrow("No synced deployment");
    expect(parseDeployment({ ...raw, contracts: { ...(raw.contracts as object), nyseCalendar: null } }).contracts.nyseCalendar).toBeNull();
  });

  it("rejects unknown fields", () => {
    expect(() => parseDeployment({ ...raw, apiKey: "x" })).toThrow();
  });

  it("rejects a malformed address", () => {
    expect(() => parseDeployment({ ...raw, contracts: { ...(raw.contracts as object), hook: "0x1234" } })).toThrow();
  });

  it("rejects an RPC that is not https", () => {
    expect(() => parseDeployment({ ...raw, publicRpc: "http://example.org" })).toThrow();
  });

  it("rejects a pool that names another hook", () => {
    const pools = raw.pools as Record<string, unknown>[];
    expect(() => parseDeployment({ ...raw, pools: [{ ...pools[0], hooks: "0x0000000000000000000000000000000000000001" }] })).toThrow("different hook");
  });
});
