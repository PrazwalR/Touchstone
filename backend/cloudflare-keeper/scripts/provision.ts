import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { parseEnv } from "node:util";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { privateKeyToAccount } from "viem/accounts";
import { loadKeeperEnv } from "../../keeper/src/config.ts";
import { loadKeystore } from "../../keeper/src/keystore.ts";

// Run on the machine that has the wallet. The decrypted key goes directly to Wrangler stdin.
const path = process.argv[2];
if (!path) throw new Error("Usage: pnpm provision /absolute/path/to/.keeper-env");
const source = parseEnv(readFileSync(path, "utf8"));
const env = loadKeeperEnv(source);
const configurationOnly = process.argv.includes("--config-only");
const signerArg = process.argv[process.argv.indexOf("--signer") + 1];
const key = configurationOnly ? undefined : loadKeystore(env.KEEPER_KEYSTORE_PATH, env.KEEPER_KEYSTORE_PASSWORD_FILE);
const signer = key ? privateKeyToAccount(key).address : signerArg;
if (!signer || !/^0x[0-9a-fA-F]{40}$/.test(signer)) throw new Error("Configuration-only mode requires --signer <public-address>");
const tokenPath = new URL("../.admin-token", import.meta.url);
const token = existsSync(tokenPath) ? readFileSync(tokenPath, "utf8").trim() : randomBytes(32).toString("hex");
if (!existsSync(tokenPath)) writeFileSync(tokenPath, token, { mode: 0o600, flag: "wx" });
const secrets: Record<string, string> = {};
const skip = new Set(["KEEPER_KEYSTORE_PATH", "KEEPER_KEYSTORE_PASSWORD_FILE", "KEEPER_STATE_PATH", "KEEPER_METRICS_PATH", "KEEPER_HERMES_WINDOW_S"]);
for (const [name, value] of Object.entries(env)) {
  if (skip.has(name)) continue;
  secrets[name] = Array.isArray(value) ? value.join(",") : String(value);
}
Object.assign(secrets, { ...(key ? { KEEPER_PRIVATE_KEY: key } : {}), KEEPER_EXPECTED_ADDRESS: signer, ADMIN_TOKEN: token });
const result = spawnSync("pnpm", ["exec", "wrangler", "secret", "bulk"], {
  input: JSON.stringify(secrets), stdio: ["pipe", "inherit", "inherit"], cwd: new URL("..", import.meta.url),
});
if (result.status !== 0) process.exit(result.status ?? 1);
console.log(`Uploaded ${configurationOnly ? "configuration only (signing key still required)" : "keeper secrets"} for public signer ${signer}. Admin token stays in .admin-token.`);
