// Node 24: load the root environment explicitly with --env-file; never print secret values.
import { existsSync, statSync } from "node:fs";
import { indexerEnvSchema } from "../indexer/src/config.ts";
import { keeperEnvSchema } from "../keeper/src/config.ts";
import { checkWiringAt } from "../keeper/src/wiring.ts";

let blocked = false;
for (const [service, schema] of [["indexer", indexerEnvSchema], ["keeper", keeperEnvSchema]]) {
  const result = schema.safeParse(process.env);
  const invalid = result.success ? [] : result.error.issues.map((i) => i.path.join("."));
  console.log(JSON.stringify({ service, validConfig: result.success, missingOrInvalidFields: invalid }));
  if (!result.success) blocked = true;
}
for (const name of ["KEEPER_KEYSTORE_PATH", "KEEPER_KEYSTORE_PASSWORD_FILE"]) {
  const path = process.env[name];
  const exists = Boolean(path && existsSync(path));
  const privateFile = exists && (statSync(path).mode & 0o777) === 0o600;
  console.log(JSON.stringify({ field: name, exists, mode600: privateFile }));
  if (!exists || !privateFile) blocked = true;
}
const keeper = keeperEnvSchema.safeParse(process.env);
if (keeper.success) {
  const env = keeper.data;
  try {
    const problems = await checkWiringAt(env.KEEPER_RPC_URL, env.KEEPER_CHAIN_ID, {
      hook: env.TOUCHSTONE_HOOK,
      settler: env.TOUCHSTONE_SETTLER,
      factory: env.TOUCHSTONE_FACTORY,
      ledger: env.TOUCHSTONE_LEDGER,
      ...(env.TOUCHSTONE_LICENCE === undefined ? {} : { licence: env.TOUCHSTONE_LICENCE }),
    });
    console.log(JSON.stringify({ check: "deployment wiring", ok: problems.length === 0, problems }));
    if (problems.length) blocked = true;
  } catch {
    // The RPC URL may carry a provider key, so the error text is not printed.
    console.log(JSON.stringify({ check: "deployment wiring", ok: false, problems: ["RPC unreachable or returned an invalid answer"] }));
    blocked = true;
  }
}
console.log(JSON.stringify({ ready: !blocked, note: "Configuration, file metadata and read-only chain calls; no password read, signing or transaction." }));
process.exitCode = blocked ? 1 : 0;
