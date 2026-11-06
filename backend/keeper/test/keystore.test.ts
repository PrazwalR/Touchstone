import { readFileSync } from "node:fs";
import { privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";
import { decryptKeystore, loadKeystore } from "../src/keystore.ts";

// A throwaway key, generated for this test with `cast wallet new` and encrypted by `cast wallet import`.
const dir = new URL("./fixtures/", import.meta.url);
const expected = readFileSync(new URL("expected-address.txt", dir), "utf8").trim();

describe("keystore", () => {
  it("decrypts a cast keystore to the expected account", () => {
    const key = loadKeystore(new URL("keystore.json", dir).pathname, new URL("password.txt", dir).pathname);
    expect(privateKeyToAccount(key).address).toBe(expected);
  });

  it("rejects a wrong password", () => {
    expect(() => decryptKeystore(readFileSync(new URL("keystore.json", dir), "utf8"), "wrong")).toThrow("password");
  });
});
