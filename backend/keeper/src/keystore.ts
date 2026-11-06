import { createDecipheriv, pbkdf2Sync, scryptSync } from "node:crypto";
import { readFileSync } from "node:fs";
import { keccak256, type Hex } from "viem";
import { z } from "zod";

// Web3 Secret Storage v3, as `cast wallet import` writes it. The decrypted key lives only in memory.
const keystoreSchema = z.object({
  version: z.literal(3),
  crypto: z.object({
    cipher: z.literal("aes-128-ctr"),
    cipherparams: z.object({ iv: z.string().regex(/^[0-9a-f]{32}$/i) }),
    ciphertext: z.string().regex(/^[0-9a-f]+$/i),
    kdf: z.enum(["scrypt", "pbkdf2"]),
    kdfparams: z.record(z.string(), z.union([z.number(), z.string()])),
    mac: z.string().regex(/^[0-9a-f]{64}$/i),
  }),
});

function derive(kdf: "scrypt" | "pbkdf2", params: Record<string, number | string>, password: string): Buffer {
  const salt = Buffer.from(String(params["salt"]), "hex");
  const dklen = Number(params["dklen"]);
  if (kdf === "scrypt") {
    const n = Number(params["n"]);
    const r = Number(params["r"]);
    const p = Number(params["p"]);
    return scryptSync(password, salt, dklen, { N: n, r, p, maxmem: 256 * n * r });
  }
  if (params["prf"] !== "hmac-sha256") throw new Error("unsupported keystore prf");
  return pbkdf2Sync(password, salt, Number(params["c"]), dklen, "sha256");
}

export function decryptKeystore(json: string, password: string): Hex {
  const ks = keystoreSchema.parse(JSON.parse(json));
  const key = derive(ks.crypto.kdf, ks.crypto.kdfparams, password);
  const ciphertext = Buffer.from(ks.crypto.ciphertext, "hex");
  const mac = keccak256(Buffer.concat([key.subarray(16, 32), ciphertext])).slice(2);
  if (mac.toLowerCase() !== ks.crypto.mac.toLowerCase()) throw new Error("keystore password is wrong or the file is corrupt");
  const decipher = createDecipheriv("aes-128-ctr", key.subarray(0, 16), Buffer.from(ks.crypto.cipherparams.iv, "hex"));
  const priv = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return `0x${priv.toString("hex")}`;
}

export function loadKeystore(path: string, passwordFile: string): Hex {
  return decryptKeystore(readFileSync(path, "utf8"), readFileSync(passwordFile, "utf8").trim());
}
