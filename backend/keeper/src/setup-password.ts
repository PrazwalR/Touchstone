// Run on the machine holding the encrypted keeper wallet. No transaction is signed or sent.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { privateKeyToAccount } from "viem/accounts";
import { decryptKeystore, loadKeystore } from "./keystore.ts";

const root = fileURLToPath(new URL("../../../", import.meta.url));
try {
  const envFile = resolve(root, ".env");
  if (existsSync(envFile)) process.loadEnvFile(envFile);
  const keystore = resolve(process.env.KEEPER_KEYSTORE_PATH || resolve(homedir(), ".foundry/keystores/touchstone-keeper"));
  const passwordFile = resolve(process.env.KEEPER_KEYSTORE_PASSWORD_FILE || resolve(homedir(), ".touchstone-keeper-pass"));
  if (!existsSync(keystore)) throw new Error("Keeper keystore not found. On the signer machine, set KEEPER_KEYSTORE_PATH to the existing touchstone-keeper file in ~/.foundry/keystores.");
  const outside = relative(realpathSync(root), realpathSync(dirname(passwordFile)));
  if (outside !== ".." && !outside.startsWith(`..${sep}`) && !isAbsolute(outside)) throw new Error("Keep the password file outside the repository.");
  if ((statSync(keystore).mode & 0o777) !== 0o600) throw new Error("Set the keeper keystore permissions to 600 before continuing.");
  if (existsSync(passwordFile)) {
    if ((statSync(passwordFile).mode & 0o777) !== 0o600) throw new Error("Set the password file permissions to 600 before continuing.");
    const account = privateKeyToAccount(loadKeystore(keystore, passwordFile));
    console.log(`Existing password file is valid. Keeper address: ${account.address}`);
  } else {
    if (!process.stdin.isTTY) throw new Error("Run this command in an interactive terminal so the password stays hidden.");
    // getpass reads the terminal without echo. The password travels only through an anonymous pipe.
    const prompt = spawnSync("python3", ["-c", "import getpass, sys; sys.stdout.write(getpass.getpass('Existing keeper keystore password: '))"], { stdio: ["inherit", "pipe", "inherit"], encoding: "utf8" });
    if (prompt.error || prompt.status !== 0) throw new Error("Unable to read a hidden password; run from a terminal with Python 3 installed.");
    const password = prompt.stdout;
    if (!password || password !== password.trim()) throw new Error("Empty passwords or leading/trailing whitespace are not supported by the keeper.");
    // Validate before persisting anything. wx refuses overwriting a file or following an existing symlink.
    const account = privateKeyToAccount(decryptKeystore(readFileSync(keystore, "utf8"), password));
    writeFileSync(passwordFile, password, { flag: "wx", mode: 0o600 });
    console.log(`Created private password file: ${passwordFile}\nKeeper address: ${account.address}`);
  }
  console.log("No transaction sent. Run keeper preflight, then start the keeper.");
} catch (err) {
  console.error(err instanceof Error ? err.message : "Keeper password setup failed.");
  process.exitCode = 1;
}
