import { readFileSync } from "node:fs";
const [url, action] = process.argv.slice(2);
if (!url || !["start", "stop", "status"].includes(action ?? "")) throw new Error("Usage: pnpm control https://<worker>.workers.dev start|stop|status");
const endpoint = new URL(url);
if (endpoint.protocol !== "https:" && endpoint.hostname !== "localhost" && endpoint.hostname !== "127.0.0.1") throw new Error("Use HTTPS for the admin token");
endpoint.pathname = `/${action}`;
const token = readFileSync(new URL("../.admin-token", import.meta.url), "utf8").trim();
const response = await fetch(endpoint, { method: action === "status" ? "GET" : "POST", redirect: "error",
  headers: { authorization: `Bearer ${token}` } });
console.log(await response.text());
if (!response.ok) process.exitCode = 1;
